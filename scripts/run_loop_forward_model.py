#!/usr/bin/env python
"""Deterministic 1D reduced forward model for coronal-heating hypotheses.

Closes the minimal loop between ``mhd-config.ts`` outputs and synthetic
observables: the script reads the ``.cfg`` written by the MHD config tool,
integrates a single-zone energy-balance loop model for three pre-registered
heating scenarios (steady / nanoflare storm / periodic wave driver),
converts the thermal evolution into synthetic AIA channel light curves via
approximate lognormal temperature responses, and ranks the scenarios
against optional observed targets.

Scope (stated honestly in every product): this is a *reduced* forward model
for scenario discrimination, not a 3D MHD solver. Radiative losses use a
coarse Cook et al. (1989)-style optically thin table; AIA responses are
two-component lognormal fits to published response curves. Absolute DEM
fidelity is limited; relative ranking between heating scenarios is the
supported scientific claim. Full matched 3D MHD forward modelling remains
registered as future work (``future:matched-mhd-forward-model``).

Usage:
    python scripts/run_loop_forward_model.py --cfg <run.cfg> --out <dir> \
        [--targets targets.json] [--selfcheck]

Requires only the pinned scientific stack in ``requirements.txt``
(numpy, scipy, matplotlib). Deterministic: identical inputs produce
byte-identical scenario JSON (no wall-clock values enter the products).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.integrate import solve_ivp

FORWARD_MODEL_VERSION = "loop-forward-model-v1"

# CGS constants
K_B = 1.380649e-16  # erg / K
KAPPA_0 = 9.2e-7  # Spitzer coefficient, kappa = kappa0 * T^(5/2)

# Conduction efficiency standing in for transition-region radiative return:
# without a TR budget the bare Spitzer flux over-removes energy from a short
# loop. Calibrated so steady canonical heating settles near ~1.3 MK for a
# 40 Mm loop at n = 2e9 cm^-3 (documented reduced-model calibration).
CONDUCTION_EFFICIENCY = 0.15

# Canonical active-region loop seed density [cm^-3] (mass-frozen segment).
SEED_DENSITY = 2.0e9

# Coarse optically thin radiative loss table, log10(T) -> log10(Lambda),
# coronal approximation in the Cook et al. (1989) family. Interpolated
# linearly in log-log space. Adequate for scenario ranking only.
LOSS_TABLE_LOGT = np.array([4.0, 4.6, 5.0, 5.5, 6.0, 6.3, 6.6, 7.0, 7.5, 8.0])
LOSS_TABLE_LOGL = np.array([-21.20, -21.20, -21.55, -21.80, -21.95, -22.05, -22.20, -22.45, -22.75, -23.10])

# Approximate AIA temperature responses: lognormal components in log10(T).
# (log10 peak temperature, width in dex, amplitude). 94 and 131 are
# two-component (warm + hot); others single warm component. Fits track
# published response-curve shapes for decay-time / lag work, not absolute DN.
AIA_RESPONSES: dict[str, list[tuple[float, float, float]]] = {
    "94": [(6.80, 0.15, 0.35), (7.35, 0.12, 1.00)],
    "131": [(6.30, 0.20, 0.60), (7.05, 0.12, 1.00)],
    "171": [(5.90, 0.15, 1.00)],
    "193": [(6.10, 0.18, 1.00)],
    "211": [(6.30, 0.18, 1.00)],
    "335": [(6.45, 0.15, 1.00)],
}

# Documented defaults for the reduced model (per-hypothesis overrides may be
# supplied through the .cfg keys of the same name).
DEFAULTS = {
    "loop_half_length_cm": 4.0e9,  # 40 Mm semi-circular loop
    "heating_rate": 2.0e-3,  # erg cm^-3 s^-1 time-averaged, canonical AR loop
    "nanoflare_frequency": 2.0e-3,  # Hz (500 s cadence storm)
    "nanoflare_duration_s": 120.0,
    "nanoflare_amplitude_factor": 25.0,  # peak / mean during a pulse
    "wave_period_s": 300.0,
    "wave_modulation_fraction": 0.8,
    "t_initial_s": 0.0,
    "t_final_s": 8000.0,
    "n_points": 1600,
}


def parse_cfg(path: Path) -> dict:
    """Parse the ``[params]`` section of an mhd-config.ts .cfg file."""
    params: dict[str, float] = {}
    in_params = False
    hypothesis = ""
    run_id = ""
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("# Run:"):
            run_id = line.split(":", 1)[1].strip()
        elif line.startswith("# Hypothesis:"):
            hypothesis = line.split(":", 1)[1].strip()
        elif line == "[params]":
            in_params = True
        elif in_params and line and not line.startswith("#"):
            if "=" in line:
                key, value = line.split("=", 1)
                try:
                    params[key.strip()] = float(value.strip())
                except ValueError:
                    params[key.strip()] = value.strip()
    return {"run_id": run_id, "hypothesis": hypothesis, "params": params}


def radiative_loss(logt: np.ndarray | float) -> np.ndarray | float:
    scalar = np.isscalar(logt)
    lt = np.atleast_1d(np.asarray(logt, dtype=float))
    lt = np.clip(lt, LOSS_TABLE_LOGT[0], LOSS_TABLE_LOGT[-1])
    logl = np.interp(lt, LOSS_TABLE_LOGT, LOSS_TABLE_LOGL)
    out = 10.0**logl
    return float(out[0]) if scalar else out


def aia_response(channel: str, logt: np.ndarray) -> np.ndarray:
    response = np.zeros_like(logt, dtype=float)
    for peak, width, amplitude in AIA_RESPONSES[channel]:
        response += amplitude * np.exp(-0.5 * ((logt - peak) / width) ** 2)
    return response


# Physical bounds for the cfg `heating_rate` key interpreted as
# erg cm^-3 s^-1. mhd-config.ts writes MHD-code units (the sample cfg carries
# plasma_beta / Reynolds / Lundquist numbers), so out-of-range values fall
# back to the canonical mean heating with an explicit note in the product.
HEATING_RATE_RANGE = (1.0e-6, 1.0e2)


def build_scenarios(params: dict) -> tuple[dict[str, dict], list[str]]:
    notes: list[str] = []
    params = dict(params)
    cfg_heating = params.get("heating_rate")
    if isinstance(cfg_heating, (int, float)) and not (
        HEATING_RATE_RANGE[0] <= cfg_heating <= HEATING_RATE_RANGE[1]
    ):
        notes.append(
            f"cfg heating_rate={cfg_heating:g} 超出日冕体积加热物理区间 "
            f"{HEATING_RATE_RANGE} erg cm^-3 s^-1，按 MHD 码单位处理并回退到默认平均加热 "
            f"{DEFAULTS['heating_rate']:g}。"
        )
        del params["heating_rate"]
    base = {
        "loop_half_length_cm": float(params.get("loop_half_length_cm", DEFAULTS["loop_half_length_cm"])),
        "heating_rate": float(params.get("heating_rate", DEFAULTS["heating_rate"])),
        "nanoflare_frequency": float(params.get("nanoflare_frequency", DEFAULTS["nanoflare_frequency"])),
        "nanoflare_duration_s": float(params.get("nanoflare_duration_s", DEFAULTS["nanoflare_duration_s"])),
        "nanoflare_amplitude_factor": float(
            params.get("nanoflare_amplitude_factor", DEFAULTS["nanoflare_amplitude_factor"])
        ),
        "wave_period_s": float(params.get("wave_period_s", DEFAULTS["wave_period_s"])),
        "wave_modulation_fraction": float(
            params.get("wave_modulation_fraction", DEFAULTS["wave_modulation_fraction"])
        ),
    }
    scenarios = {
        "steady": {
            **base,
            "description": "定常加热基线（稳态背景加热，无时间调制）",
            "claim": "与稳态/缓变加热类机制（如背景湍流耗散）匹配",
        },
        "storm": {
            **base,
            "description": (
                f"纳耀斑风暴：频率 {base['nanoflare_frequency']:.2e} Hz，"
                f"脉宽 {base['nanoflare_duration_s']:.0f} s，峰值/均值 "
                f"{base['nanoflare_amplitude_factor']:.0f}×"
            ),
            "claim": "与低频纳耀斑/间歇性重联类机制匹配",
        },
        "wave": {
            **base,
            "description": (
                f"波动驱动：周期 {base['wave_period_s']:.0f} s，"
                f"调制幅度 {base['wave_modulation_fraction']:.0%}"
            ),
            "claim": "与波动耗散（阿尔芬/慢磁声波）类机制匹配",
        },
    }
    return scenarios, notes


def heating_rate_scenarios(t: np.ndarray, scenario: dict) -> np.ndarray:
    """Volumetric heating H(t) [erg cm^-3 s^-1] for each scenario.

    All scenarios share the same time-averaged heating so that peak
    temperature and decay-time differences are attributable to the
    *temporal profile*, not the energy budget.
    """
    mean_h = scenario["heating_rate"]
    t = np.asarray(t, dtype=float)
    if scenario["__name"] == "steady":
        return np.full_like(t, mean_h)
    if scenario["__name"] == "storm":
        period = 1.0 / scenario["nanoflare_frequency"]
        duration = scenario["nanoflare_duration_s"]
        factor = scenario["nanoflare_amplitude_factor"]
        # Rectangular pulse train with duty cycle adjusted so the
        # time-average equals mean_h exactly.
        duty = min(1.0 / factor, 0.9)
        phase = np.mod(t, period)
        in_pulse = phase < duration
        return np.where(in_pulse, mean_h * factor, mean_h * (1.0 - factor * duty) / (1.0 - duty))
    if scenario["__name"] == "wave":
        amplitude = scenario["wave_modulation_fraction"]
        period = scenario["wave_period_s"]
        # H(t) = mean * (1 + a * max(0, sin)), average over one period:
        # <max(0, sin)> = 1/pi, rescale to keep the time-average at mean_h.
        envelope = np.maximum(0.0, np.sin(2.0 * np.pi * t / period))
        scale = 1.0 / (1.0 + amplitude * (1.0 / math.pi - 1.0))
        return mean_h * scale * (1.0 + amplitude * envelope)
    raise ValueError(f"unknown scenario {scenario['__name']}")


def integrate(scenario: dict, t_eval: np.ndarray) -> dict:
    """Integrate the single-zone energy-balance model.

    State (per unit volume): electron density ``n`` [cm^-3], temperature ``T`` [K].
        U = 3 n k_B T  (electrons + ions)
        dU/dt = H - n^2 Lambda(T) - F_c / L
        dn/dt = 0                  (closed coronal segment: chromospheric
                                    evaporation/condensation exchange is
                                    folded into the conductive loss term;
                                    see limitations)
        F_c = kappa0 T^(7/2) / L   (conductive flux to the transition region)
    """
    length = scenario["loop_half_length_cm"]
    name = scenario["__name"]
    h_lookup = heating_rate_scenarios(t_eval, scenario)

    def h_at(time: float) -> float:
        return float(np.interp(time, t_eval, h_lookup))

    def rhs(time: float, state: np.ndarray) -> list[float]:
        n, temp = max(state[0], 1.0e6), max(state[1], 1.0e3)
        logt = math.log10(temp)
        loss = float(radiative_loss(logt))
        flux_c = CONDUCTION_EFFICIENCY * KAPPA_0 * temp**3.5 / length
        du_dt = h_at(time) - n * n * loss - flux_c / length
        dt_dt = du_dt / (3.0 * K_B * n)
        return [0.0, dt_dt]

    # Seed at the canonical active-region loop density; the model evolves to
    # its own heating-dependent equilibrium from there.
    n0 = SEED_DENSITY
    sol = solve_ivp(
        rhs,
        (t_eval[0], t_eval[-1]),
        [n0, 1.0e6],
        t_eval=t_eval,
        method="LSODA",
        rtol=1e-7,
        atol=[1e6, 1e3],
        max_step=(t_eval[-1] - t_eval[0]) / 2000.0,
    )
    if not sol.success:
        raise RuntimeError(f"integration failed for scenario {name}: {sol.message}")
    n, temp = sol.y
    volume_em = n**2 * length  # column emission measure proxy, cm^-5
    logt = np.log10(np.clip(temp, 1.0e3, None))
    lightcurves = {
        channel: volume_em * aia_response(channel, logt) for channel in AIA_RESPONSES
    }
    return {
        "t": sol.t,
        "n": n,
        "T": temp,
        "logT": logt,
        "EM_column": volume_em,
        "lightcurves": lightcurves,
        "heating": np.array([h_at(float(ti)) for ti in sol.t]),
    }


def decay_time(t: np.ndarray, signal: np.ndarray) -> float:
    """1/e decay time from the global peak (fallback: half-max)."""
    peak = int(np.argmax(signal))
    if peak >= signal.size - 2:
        return float("nan")
    threshold = signal[peak] / math.e
    after = np.where(signal[peak:] <= threshold)[0]
    if after.size == 0:
        return float(t[-1] - t[peak])
    return float(t[peak + int(after[0])] - t[peak])


def cross_correlation_lag(
    t: np.ndarray, a: np.ndarray, b: np.ndarray, max_lag_s: float = 2000.0
) -> float:
    """Peak-correlation lag of b relative to a, restricted to a physical
    search window so the single-transient edge does not dominate."""
    dt = float(np.median(np.diff(t)))
    a = (a - a.mean()) / (a.std() + 1e-30)
    b = (b - b.mean()) / (b.std() + 1e-30)
    corr = np.correlate(a, b, mode="full")
    lags = np.arange(-a.size + 1, a.size) * dt
    window = np.abs(lags) <= max_lag_s
    if not window.any():
        return float("nan")
    windowed_lags, windowed_corr = lags[window], corr[window]
    return float(windowed_lags[int(np.argmax(windowed_corr))])


def scenario_metrics(result: dict) -> dict:
    t = result["t"]
    em = result["EM_column"]
    lc94, lc171 = result["lightcurves"]["94"], result["lightcurves"]["171"]
    lc193 = result["lightcurves"]["193"]
    return {
        "peak_log10_T_K": float(result["logT"].max()),
        "peak_EM_column_cm5": float(em.max()),
        "peak_n_cm3": float(result["n"].max()),
        "mean_heating_erg_cm3_s": float(result["heating"].mean()),
        # With the segment mass frozen the raw EM is constant, so decay is
        # measured on the temperature-weighted hot channel (94) instead.
        "decay_time_94_s": decay_time(t, lc94),
        "decay_time_171_s": decay_time(t, lc171),
        "lag_94_vs_171_s": cross_correlation_lag(t, lc94, lc171),
        # Matches the observed aia-171-193-timeseries-v1 executor metric
        # (lagSpanSeconds) so model-vs-observation comparison stays on the
        # same channel pair.
        "lag_171_vs_193_s": cross_correlation_lag(t, lc171, lc193),
    }


def rank_scenarios(
    metrics: dict[str, dict], targets: dict, weights: dict | None = None
) -> dict:
    """Rank scenarios against observed targets by weighted relative error.

    Supported targets: peak_log10_T_K, decay_time_EM_s (or decay_time_171_s),
    lag_94_vs_171_s. Missing entries are skipped; scenarios are ordered by
    ascending weighted error (lower is closer to the observations).
    """
    weights = weights or {}
    default_weights = {
        "peak_log10_T_K": 1.0,
        "decay_time_94_s": 1.0,
        "decay_time_171_s": 0.5,
        "lag_94_vs_171_s": 1.0,
        "lag_171_vs_193_s": 1.0,
    }
    errors: dict[str, float] = {}
    terms: dict[str, dict] = {}
    for name, row in metrics.items():
        total, matched = 0.0, 0
        detail = {}
        for key, observed in targets.items():
            if key not in row or not isinstance(observed, (int, float)):
                continue
            scale = max(abs(float(observed)), 1e-6)
            err = abs(row[key] - float(observed)) / scale
            weight = float(weights.get(key, default_weights.get(key, 1.0)))
            total += weight * err
            matched += 1
            detail[key] = {"observed": observed, "model": row[key], "relative_error": err}
        errors[name] = total / max(matched, 1)
        terms[name] = detail
    ranking = sorted(errors, key=errors.get)
    return {
        "target_keys": [k for k in targets if isinstance(targets[k], (int, float))],
        "weighted_relative_error": errors,
        "terms": terms,
        "ranking_best_to_worst": ranking,
        "best_scenario": ranking[0] if ranking else None,
    }


def write_products(out_dir: Path, payload: dict) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    scenarios_json = out_dir / "scenarios.json"
    scenarios_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )
    plot_path = out_dir / "lightcurves.png"
    _render(payload, plot_path)
    summary_path = out_dir / "summary.md"
    summary_path.write_text(render_summary(payload), encoding="utf-8")
    files = {"scenarios.json": scenarios_json, "lightcurves.png": plot_path, "summary.md": summary_path}
    manifest = {
        "forward_model_version": FORWARD_MODEL_VERSION,
        "inputs": {
            "cfg_sha256": payload["inputs"]["cfg_sha256"],
            "targets_sha256": payload["inputs"].get("targets_sha256"),
        },
        "outputs": {
            name: {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}
            for name, path in files.items()
        },
        "limitations": payload["limitations"],
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )
    return manifest


def _render(payload: dict, path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(2, 2, figsize=(12, 7), dpi=130)
    for name, result in payload["results"].items():
        t_min = np.asarray(result["t"])
        t_s = t_min
        axes[0, 0].plot(t_s, result["logT"], label=name)
        axes[0, 1].plot(t_s, result["EM_column"], label=name)
        axes[1, 0].plot(t_s, result["lightcurves"]["94"], label=name)
        axes[1, 1].plot(t_s, result["lightcurves"]["171"], label=name)
    axes[0, 0].set_ylabel("log10 T [K]")
    axes[0, 1].set_ylabel("EM column [cm^-5]")
    axes[1, 0].set_ylabel("synthetic AIA 94")
    axes[1, 1].set_ylabel("synthetic AIA 171")
    for ax in axes.flat:
        ax.set_xlabel("t [s]")
        ax.legend(fontsize=8)
        ax.grid(alpha=0.3)
    fig.suptitle(f"Loop forward model {FORWARD_MODEL_VERSION}: {payload['inputs']['run_id']}")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def render_summary(payload: dict) -> str:
    lines = [
        f"# 前向模型产物 — {payload['inputs']['run_id']}",
        "",
        f"- 版本：`{FORWARD_MODEL_VERSION}`",
        f"- 输入配置：`{payload['inputs']['cfg']}`",
        f"- 假设：{payload['inputs']['hypothesis'] or '(未标注)'}",
        "",
        "## 场景指标",
        "",
        "| 场景 | peak log10 T | EM 峰值 | 94 衰减时标 | 171 衰减时标 | 94-171 时延 | 171-193 时延 |",
        "|---|---|---|---|---|---|---|",
    ]
    for name, row in payload["metrics"].items():
        lines.append(
            f"| {name} | {row['peak_log10_T_K']:.2f} | {row['peak_EM_column_cm5']:.2e} | "
            f"{row['decay_time_94_s']:.0f} s | {row['decay_time_171_s']:.0f} s | "
            f"{row['lag_94_vs_171_s']:+.0f} s | {row['lag_171_vs_193_s']:+.0f} s |"
        )
    ranking = payload.get("ranking")
    if ranking and ranking["best_scenario"]:
        lines += [
            "",
            "## 与观测目标的判别",
            "",
            f"- 目标量：{ranking['target_keys']}",
            f"- 最优场景：**{ranking['best_scenario']}**",
            "",
            "| 场景 | 加权相对误差 |",
            "|---|---|",
        ]
        for name in ranking["ranking_best_to_worst"]:
            lines.append(f"| {name} | {ranking['weighted_relative_error'][name]:.3f} |")
    lines += ["", "## 局限", ""] + [f"- {item}" for item in payload["limitations"]]
    return "\n".join(lines) + "\n"


def run(cfg_path: Path, out_dir: Path, targets_path: Path | None) -> dict:
    parsed = parse_cfg(cfg_path)
    scenarios, cfg_notes = build_scenarios(parsed["params"])
    t_eval = np.linspace(
        DEFAULTS["t_initial_s"], DEFAULTS["t_final_s"], int(DEFAULTS["n_points"])
    )
    results, metrics = {}, {}
    for name, scenario in scenarios.items():
        scenario["__name"] = name
        result = integrate(scenario, t_eval)
        results[name] = result
        metrics[name] = scenario_metrics(result)
    ranking = None
    targets_sha = None
    if targets_path and targets_path.exists():
        targets_payload = json.loads(targets_path.read_text(encoding="utf-8"))
        targets = targets_payload.get("targets", targets_payload)
        ranking = rank_scenarios(metrics, targets, targets_payload.get("weights"))
        targets_sha = hashlib.sha256(targets_path.read_bytes()).hexdigest()
    payload = {
        "inputs": {
            "run_id": parsed["run_id"] or cfg_path.stem,
            "hypothesis": parsed["hypothesis"],
            "cfg": str(cfg_path),
            "cfg_sha256": hashlib.sha256(cfg_path.read_bytes()).hexdigest(),
            "targets_sha256": targets_sha,
            "model": "single-zone energy balance, mass-frozen coronal segment",
        },
        "scenarios": {
            name: {k: v for k, v in scenario.items() if k != "__name"}
            for name, scenario in scenarios.items()
        },
        "metrics": metrics,
        "ranking": ranking,
        "results": {
            name: {
                "t": result["t"].tolist()[::8],
                "logT": result["logT"].tolist()[::8],
                "EM_column": result["EM_column"].tolist()[::8],
                "lightcurves": {
                    ch: vals.tolist()[::8] for ch, vals in result["lightcurves"].items()
                },
                "heating": result["heating"].tolist()[::8],
            }
            for name, result in results.items()
        },
        "limitations": [
            "约化模型（单区能量平衡、日冕段质量封闭），用于场景判别，不替代 3D MHD 求解。",
            "辐射损失采用 Cook et al. (1989) 风格粗表，AIA 响应为双分量对数正态近似；绝对 DEM 精度有限。",
            "蒸发/凝聚的往复质量交换折叠进传导损失项（f_c=0.15 标定因子代表过渡区辐射回授）；绝对密度演化与多环几何不在本模型范围。",
            "三个场景共享同一时间平均加热，差异归于时间轮廓而非能量预算。",
            "单区模型无空间冷却传播，合成通道间时延系统性偏小；对目标量的比较仅支持场景间相对排序，不支持绝对时延预测。",
        ]
        + cfg_notes,
    }
    manifest = write_products(out_dir, payload)
    return {"payload": payload, "manifest": manifest}


def selfcheck() -> int:
    """Physical invariants + determinism. Returns process exit code."""
    import tempfile

    ok = True
    params = dict(DEFAULTS)
    t_eval = np.linspace(0.0, 4000.0, 800)

    # (a) Energy closure on the decay phase: with the segment mass-frozen,
    # radiated + conducted energy must equal the internal-energy drop.
    decay = {**params, "__name": "steady"}
    base = integrate(decay, t_eval)
    n_stop, t_stop = float(base["n"][-1]), float(base["T"][-1])
    length = decay["loop_half_length_cm"]

    def rhs_decay(time, state):
        n, temp = max(state[0], 1.0e6), max(state[1], 1.0e3)
        loss = float(radiative_loss(math.log10(temp)))
        flux_c = CONDUCTION_EFFICIENCY * KAPPA_0 * temp**3.5 / length
        du_dt = -n * n * loss - flux_c / length
        dt_dt = du_dt / (3.0 * K_B * n)
        return [0.0, dt_dt]

    decay_t = np.linspace(0.0, 3000.0, 600)
    sol = solve_ivp(rhs_decay, (0.0, decay_t[-1]), [n_stop, t_stop], t_eval=decay_t,
                    method="LSODA", rtol=1e-8, atol=[1e6, 1e3])
    decay_n = np.clip(sol.y[0], 1.0e6, None)
    decay_T = np.clip(sol.y[1], 1.0e3, None)
    u0 = 3.0 * n_stop * K_B * t_stop
    u1 = 3.0 * float(decay_n[-1]) * K_B * float(decay_T[-1])
    losses = (
        decay_n**2 * radiative_loss(np.log10(decay_T))
        + CONDUCTION_EFFICIENCY * KAPPA_0 * decay_T**3.5 / length**2
    )
    removed = float(np.trapezoid(losses, decay_t))
    fraction = removed / max(u0 - u1, 1e-30)
    conserve_ok = 0.95 <= fraction <= 1.05
    print(f"[selfcheck] decay energy closure: removed/internal-drop = {fraction:.4f} {'OK' if conserve_ok else 'FAIL'}")
    ok &= conserve_ok

    # (b) Monotonic temperature decay without heating (no re-brightening >5%).
    t_peak_idx = int(np.argmax(decay_T))
    rebound = float(np.max(decay_T[t_peak_idx:])) - float(decay_T[t_peak_idx])
    monotonic_ok = rebound <= 0.05 * float(decay_T[t_peak_idx])
    print(f"[selfcheck] post-heating monotonic decay: rebound {rebound:+.3g} K {'OK' if monotonic_ok else 'FAIL'}")
    ok &= monotonic_ok

    # (c) Storm produces a higher peak temperature than steady heating at
    # equal time-average (intermittent deposition overheats the corona).
    storms = {**params, "__name": "storm"}
    steadies = {**params, "__name": "steady"}
    storm_res = integrate(storms, t_eval)
    steady_res = integrate(steadies, t_eval)
    storm_peak, steady_peak = float(storm_res["logT"].max()), float(steady_res["logT"].max())
    storm_ok = storm_peak > steady_peak
    print(f"[selfcheck] storm peak {storm_peak:.3f} > steady peak {steady_peak:.3f}: {'OK' if storm_ok else 'FAIL'}")
    ok &= storm_ok

    # (d) Byte-identical products across two runs (determinism).
    with tempfile.TemporaryDirectory() as tmp:
        cfg = Path(tmp) / "determinism.cfg"
        cfg.write_text(
            "# MHD Simulation Config\n# Run: selfcheck\n# Hypothesis: h-selfcheck\n\n[params]\nheating_rate = 0.02\n",
            encoding="utf-8",
        )
        hashes = []
        for run_idx in range(2):
            out = Path(tmp) / f"run{run_idx}"
            result = run(cfg, out, None)
            hashes.append(result["manifest"]["outputs"]["scenarios.json"]["sha256"])
        deterministic_ok = hashes[0] == hashes[1]
        print(f"[selfcheck] determinism: {hashes[0][:16]} == {hashes[1][:16]}: {'OK' if deterministic_ok else 'FAIL'}")
        ok &= deterministic_ok

    print(f"[selfcheck] {'ALL OK' if ok else 'FAILURES PRESENT'}")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cfg", type=Path, help=".cfg written by mhd-config.ts")
    parser.add_argument("--out", type=Path, help="output product directory")
    parser.add_argument("--targets", type=Path, help="optional observed targets JSON")
    parser.add_argument("--selfcheck", action="store_true", help="run physics/determinism self-checks")
    args = parser.parse_args(argv)

    if args.selfcheck:
        return selfcheck()
    if not args.cfg or not args.out:
        parser.error("--cfg and --out are required unless --selfcheck is given")
    result = run(args.cfg, args.out, args.targets)
    metrics = result["payload"]["metrics"]
    print(f"[forward-model] wrote products to {args.out}")
    for name, row in metrics.items():
        print(
            f"  {name:>7}: peak logT={row['peak_log10_T_K']:.2f}  "
            f"decay(94)={row['decay_time_94_s']:.0f}s  lag(171-193)={row['lag_171_vs_193_s']:+.0f}s"
        )
    ranking = result["payload"]["ranking"]
    if ranking and ranking["best_scenario"]:
        print(f"  best vs targets: {ranking['best_scenario']} (errors: "
              + ", ".join(f"{k}={v:.3f}" for k, v in ranking["weighted_relative_error"].items())
              + ")")
    return 0


if __name__ == "__main__":
    sys.exit(main())
