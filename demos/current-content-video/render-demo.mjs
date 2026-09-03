import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const demoDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(demoDir, '..', '..')
const resultPath = resolve(
  process.env.SCIENTIFIC_RESULT_PATH ??
    join(projectRoot, 'outputs', 'ar11158-qwen-demo', 'scientific-result.json'),
)
const outputPath = resolve(
  process.argv[2] ?? join(demoDir, 'open-scientist-hyperframes-demo-v3.mp4'),
)
const hyperframesVersion = process.env.HYPERFRAMES_VERSION ?? '0.8.6'
const durationSeconds = 175
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const defaultBrowserPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browserPath =
  process.env.HYPERFRAMES_BROWSER_PATH ??
  (existsSync(defaultBrowserPath) ? defaultBrowserPath : undefined)

function countBy(items, key) {
  return (items ?? []).reduce((counts, item) => {
    const value = String(item?.[key] ?? 'unknown')
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})
}

function groupBy(items, keyFn) {
  return (items ?? []).reduce((groups, item) => {
    const key = String(keyFn(item))
    ;(groups[key] ??= []).push(item)
    return groups
  }, {})
}

function compactText(value, maxLength) {
  const text = String(value ?? '')
    .replace(/\\s+/g, ' ')
    .trim()
  return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text
}

function unique(items) {
  return [...new Set((items ?? []).map((item) => String(item).trim()).filter(Boolean))]
}

function shortId(value, length = 12) {
  const text = String(value ?? '')
  return text.length > length ? text.slice(0, length) + '…' : text
}

function runHyperframes(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(npxCommand, ['--yes', 'hyperframes@' + hyperframesVersion, ...args], {
      cwd: demoDir,
      env: {
        ...process.env,
        HYPERFRAMES_TELEMETRY: '0',
        ...(browserPath ? { HYPERFRAMES_BROWSER_PATH: browserPath } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      const value = chunk.toString()
      stdout += value
      process.stdout.write(value)
    })
    child.stderr.on('data', (chunk) => {
      const value = chunk.toString()
      stderr += value
      process.stderr.write(value)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr })
        return
      }
      reject(
        new Error(
          'HyperFrames command failed (' +
            code +
            '): ' +
            args.join(' ') +
            '\\n' +
            (stderr || stdout),
        ),
      )
    })
  })
}

function findDiagnosticMetrics(evidence) {
  for (const item of evidence ?? []) {
    const metrics = item?.metrics ?? {}
    const quantitative = item?.quantitativeResults ?? metrics.quantitativeResults ?? []
    const correlation = Number(
      metrics.crossChannelCorrelation ??
        quantitative.find((entry) => String(entry?.metric).toLowerCase().includes('correlation'))
          ?.estimate,
    )
    const period = Number(metrics.periodsSeconds?.[0])
    if (Number.isFinite(correlation) || Number.isFinite(period)) {
      return {
        correlation: Number.isFinite(correlation) ? correlation : 0,
        period: Number.isFinite(period) ? period : 0,
      }
    }
  }
  return { correlation: 0, period: 0 }
}

function findFileCoverage(evidence) {
  for (const item of evidence ?? []) {
    const observed = String(item?.observed ?? '')
    const match = observed.match(/(\d+)\s*\/\s*(\d+)\s*(?:\u4e2a\u6587\u4ef6|files?)/i)
    if (match) return match[1] + '/' + match[2]
  }
  return '—'
}

function chooseLimitations(source) {
  const values = source ?? []
  const choose = (needle, fallback) =>
    values.find((item) => String(item).toLowerCase().includes(needle.toLowerCase())) ?? fallback
  return [
    choose('spectroscopy', '当前没有光谱或非热展宽诊断。'),
    choose('24-second', '24 秒突发窗口只覆盖一个 AIA 双波段窗口。'),
    choose('WCS', '完整 WCS 对齐尚未执行，ROI 仍需人工复核。'),
    choose('积分强度周期', '积分强度周期不是传播速度或能流测量。'),
    choose('MHD', '当前不包含 DEM 反演、能量闭合或 MHD 前向模拟。'),
    choose('联合特征', '当前没有联合特征定量指标。'),
  ]
}

function roleForAgent(agentId) {
  const id = String(agentId ?? '')
  if (id.includes('oracle-processing')) return 'provenance'
  if (id.includes('looker')) return 'looker'
  if (id.includes('explorer')) return 'explorer'
  if (id.includes('oracle')) return 'oracle'
  return 'other'
}

function roleSpecs() {
  return [
    {
      key: 'looker',
      label: 'LOOKER',
      title: '观测目录与语境审计',
      description: '核对来源、观测窗口和既有研究语境',
      color: 'var(--cyan)',
    },
    {
      key: 'explorer',
      label: 'EXPLORER',
      title: 'FITS 可观测量分析',
      description: '执行 ROI、时间序列和图像诊断',
      color: 'var(--solar)',
    },
    {
      key: 'oracle',
      label: 'ORACLE',
      title: '反例与交叉验证',
      description: '寻找背景差异、反例和替代解释',
      color: 'var(--violet)',
    },
    {
      key: 'provenance',
      label: 'FACT-CHECK',
      title: '处理溯源复核',
      description: '复核 snapshot、processing run 和 artifact',
      color: 'var(--warn)',
    },
  ]
}

function buildGateChecks(result, evidenceCounts) {
  const evidence = result.evidence ?? []
  const supportCount = evidenceCounts.support ?? 0
  const quantitative = evidence.some((item) => (item.quantitativeResults ?? []).length > 0)
  const holdout = evidence.some((item) => item.lineage?.analysisSplit === 'holdout')
  const confidence = Math.max(
    ...(result.hypotheses ?? []).map((item) => Number(item.confidence) || 0),
    0,
  )
  return [
    {
      label: '可量化结果与区间',
      value: quantitative ? 'present' : 'missing',
      state: quantitative ? 'pass' : 'hold',
    },
    {
      label: '支持记录 ≥ 3',
      value: supportCount + ' / 3',
      state: supportCount >= 3 ? 'pass' : 'hold',
    },
    { label: '独立事件与原始谱系', value: 'requires ≥ 3', state: 'hold' },
    { label: '观测族 / 方法族', value: 'requires ≥ 2 / 2', state: 'hold' },
    {
      label: '独立 holdout',
      value: holdout ? 'present' : 'missing',
      state: holdout ? 'pass' : 'hold',
    },
    { label: '覆盖全部预测', value: 'not complete', state: 'hold' },
    {
      label: 'confidence ≥ 0.60',
      value: confidence.toFixed(2),
      state: confidence >= 0.6 ? 'pass' : 'hold',
    },
  ]
}

function buildFrameworkLayers() {
  return [
    {
      index: '01',
      name: 'API / SSE',
      path: 'apps/api/src/routes/runs.ts',
      detail: 'POST /runs · stream · resume',
    },
    {
      index: '02',
      name: 'WORKFLOW',
      path: 'packages/agents/.../workflow.ts',
      detail: 'runtime · context · persistence',
    },
    {
      index: '03',
      name: 'LANGGRAPH',
      path: 'scientific-graph.ts',
      detail: 'A / B / C / D · checkpointed State',
    },
    {
      index: '04',
      name: 'TOOLS / MCP',
      path: 'packages/tools/src + packages/mcp/src',
      detail: 'FITS · solar data · search · sandbox',
    },
    {
      index: '05',
      name: 'STORAGE / ARTIFACTS',
      path: 'packages/storage/src/repo',
      detail: 'records · snapshots · runs · checksums',
    },
  ]
}

function buildGraphNodes() {
  return [
    { id: 'A.generate', title: '生成假设', io: 'phenomenon → hypotheses', color: 'var(--solar)' },
    {
      id: 'A.verify',
      title: '结构检查',
      io: 'schema · predictions · falsification',
      color: 'var(--solar)',
    },
    { id: 'B.run', title: '证据工作组', io: 'agents → evidence / tasks', color: 'var(--cyan)' },
    {
      id: 'BC.verify',
      title: '证据晋级',
      io: 'provenance → auditable records',
      color: 'var(--warn)',
    },
    { id: 'C.verify', title: '严格门槛', io: 'gate → status / confidence', color: 'var(--violet)' },
    { id: 'C.synthesize', title: '收敛结论', io: 'bounded conclusion', color: 'var(--violet)' },
    { id: 'D.plan', title: '规划验证', io: 'gaps → validation tasks', color: 'var(--solar)' },
    { id: 'D.route', title: '条件路由', io: 'A / B / END', color: 'var(--cyan)' },
  ]
}

function buildAgentRoles(executions) {
  return roleSpecs().map((spec) => {
    const matching = (executions ?? []).filter((item) => roleForAgent(item.agentId) === spec.key)
    return {
      ...spec,
      executions: matching.length,
      completed: matching.filter((item) => item.status === 'completed').length,
      skipped: matching.filter((item) => item.status === 'skipped').length,
      rounds: unique(matching.map((item) => item.round)).join(' / '),
    }
  })
}

function buildRoundStats(result) {
  const rounds = unique([
    ...(result.evidence ?? []).map((item) => item.round),
    ...(result.validationTasks ?? []).map((item) => item.round),
    ...(result.agentExecutions ?? []).map((item) => item.round),
    ...(result.corrections ?? []).map((item) => item.round),
  ]).sort((a, b) => Number(a) - Number(b))
  return rounds.map((round) => {
    const evidence = (result.evidence ?? []).filter((item) => item.round === Number(round))
    const tasks = (result.validationTasks ?? []).filter((item) => item.round === Number(round))
    const agents = (result.agentExecutions ?? []).filter((item) => item.round === Number(round))
    const corrections = (result.corrections ?? []).filter((item) => item.round === Number(round))
    return {
      round: Number(round),
      evidence: evidence.length,
      support: evidence.filter((item) => item.status === 'support').length,
      unknown: evidence.filter((item) => item.status === 'unknown').length,
      tasks: tasks.length,
      completedTasks: tasks.filter((item) => item.status === 'completed').length,
      plannedTasks: tasks.filter((item) => item.status === 'planned').length,
      agents: agents.length,
      completedAgents: agents.filter((item) => item.status === 'completed').length,
      skippedAgents: agents.filter((item) => item.status === 'skipped').length,
      corrections: corrections.length,
    }
  })
}

function taskReadiness(task) {
  if (task.status === 'completed') return 'completed'
  if (task.executorId === 'external') return 'requires_data'
  return 'registered_executor'
}

function taskLabel(task) {
  const objective = compactText(task.objective, 116)
  return {
    id: shortId(task.taskId, 18),
    executor: shortId(task.executorId ?? 'external', 28),
    route: task.route ?? 'B',
    type: task.type ?? 'analysis',
    status: task.status ?? 'planned',
    readiness: taskReadiness(task),
    objective,
  }
}

function buildTaskGroups(result) {
  const tasks = result.validationTasks ?? []
  const planned = (result.nextValidationPlan ?? tasks.filter((task) => task.status === 'planned'))
    .filter((task) => task.status === 'planned')
    .map(taskLabel)
  return {
    featured: planned.slice(0, 6),
    handoff: planned.slice(0, 3),
    more: Math.max(0, planned.length - 6),
  }
}

function buildCorrections(result) {
  return (result.corrections ?? []).slice(0, 5).map((item) => ({
    stage: item.stage ?? '—',
    kind: item.kind ?? 'factual',
    severity: item.severity ?? 'warning',
    message: compactText(item.message, 120),
    action: compactText(item.action, 120),
    round: item.round ?? 0,
  }))
}

async function loadDemoData() {
  const source = await readFile(resultPath, 'utf8')
  const result = JSON.parse(source)
  const requestPath = join(dirname(resultPath), 'request.json')
  const request = existsSync(requestPath) ? JSON.parse(await readFile(requestPath, 'utf8')) : {}
  const evidenceCounts = countBy(result.evidence, 'status')
  const taskCounts = countBy(result.validationTasks, 'status')
  const agentCounts = countBy(result.agentExecutions, 'status')
  const metrics = findDiagnosticMetrics(result.evidence)
  const rounds = buildRoundStats(result)
  const tasks = buildTaskGroups(result)
  const phenomenon = request.phenomenon ?? {}
  const maxConfidence = Math.max(
    ...(result.hypotheses ?? []).map((item) => Number(item.confidence) || 0),
    0,
  )

  return {
    runId: result.runId,
    runShortId: shortId(result.runId, 22),
    status: result.status,
    scientificStatus: result.scientificStatus,
    terminationReason: result.terminationReason,
    totalRounds: result.totalRounds ?? rounds.length,
    hypothesisCount: result.hypotheses?.length ?? 0,
    evidenceTotal: result.evidence?.length ?? 0,
    evidenceSupport: evidenceCounts.support ?? 0,
    evidenceUnknown: evidenceCounts.unknown ?? 0,
    evidenceContradict: evidenceCounts.contradict ?? 0,
    taskTotal: result.validationTasks?.length ?? 0,
    tasksCompleted: taskCounts.completed ?? 0,
    tasksPlanned: taskCounts.planned ?? 0,
    agentTotal: result.agentExecutions?.length ?? 0,
    agentsCompleted: agentCounts.completed ?? 0,
    agentsSkipped: agentCounts.skipped ?? 0,
    correctionCount: result.corrections?.length ?? 0,
    maxConfidence,
    conclusion: compactText(result.conclusion, 180),
    phenomenon: {
      title: phenomenon.title ?? 'NOAA AR11158 多波段热响应与磁场演化',
      activeRegion: phenomenon.activeRegion ?? 'NOAA 11158',
      description: compactText(
        phenomenon.description ??
          'AIA 热通道出现间歇性增强，171/193 Å 同时存在准周期变化，HMI 记录目标区域磁场演化。',
        220,
      ),
      requestedQuestion: compactText(
        phenomenon.requestedQuestion ??
          '哪些可重复处理指标可以区分波动耗散、间歇性重联和耦合机制？',
        180,
      ),
    },
    hypotheses: (result.hypotheses ?? []).slice(0, 3).map((hypothesis) => ({
      id: shortId(hypothesis.id, 18),
      statement: compactText(hypothesis.statement, 156),
      confidence: hypothesis.confidence ?? 0,
      status: hypothesis.status,
      mechanism:
        hypothesis.mechanismComposition?.map((item) => item.mechanism).join(' × ') ??
        '待补充机制组成',
      predictionCount: hypothesis.predictions?.length ?? 0,
      falsificationCount: hypothesis.falsificationConditions?.length ?? 0,
    })),
    frameworkLayers: buildFrameworkLayers(),
    graphNodes: buildGraphNodes(),
    agentRoles: buildAgentRoles(result.agentExecutions),
    modelRoleCount: unique(
      (result.agentExecutions ?? [])
        .filter((item) => String(item.agentId).includes('model'))
        .map((item) => item.agentId),
    ).length,
    deterministicRoleCount: 4,
    rounds,
    gateChecks: buildGateChecks(result, evidenceCounts),
    corrections: buildCorrections(result),
    limitations: chooseLimitations(result.limitations),
    tasks: tasks.featured,
    handoffTasks: tasks.handoff,
    validationMore: tasks.more > 0 ? '+ ' + tasks.more + ' 条验证任务排队' : '验证任务已全部列出',
    fileCountLabel: findFileCoverage(result.evidence),
    candidatePeriodSeconds: metrics.period,
    crossChannelCorrelation: metrics.correlation,
    diagnosticImage: './coronal_diagnostics.png',
    sourceDigest: createHash('sha256').update(source).digest('hex').slice(0, 12),
  }
}

async function main() {
  const data = await loadDemoData()
  await writeFile(
    join(demoDir, 'data.js'),
    'window.__OPEN_SCIENTIST_DEMO__ = ' + JSON.stringify(data, null, 2) + ';\n',
    'utf8',
  )

  console.log('\n[HyperFrames] Rendering storyboard v3 / compact scientific trace')
  console.log('[HyperFrames] composition: ' + join(demoDir, 'hyperframes-compact.html'))
  console.log('[HyperFrames] source result: ' + resultPath)

  await runHyperframes([
    'render',
    demoDir,
    '--composition',
    'hyperframes-compact.html',
    '--quality',
    'high',
    '--fps',
    '30',
    '--output',
    outputPath,
    '--strict',
  ])

  console.log(
    JSON.stringify(
      {
        outputPath,
        durationSeconds,
        resolution: '1920x1080',
        fps: 30,
        renderer: 'heygen-com/hyperframes',
        sourceDigest: data.sourceDigest,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\\n')
  process.exitCode = 1
})
