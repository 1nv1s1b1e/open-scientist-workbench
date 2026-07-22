import type { AgentRuntimeConfig, ModelArg } from '@open-scientist/config'
import type { EvidenceAlignment } from '@open-scientist/schema'
import { persistAgentRun } from '../shared/persist.ts'
import { type EmitChunk, streamAgentOutput } from '../shared/stream.ts'
import { extractSubmitResult } from '../shared/tool-output.ts'
import { createLookerAgent } from './agent.ts'

export interface LookerWorkflowInput {
  /** Hypothesis id — drives per-hypothesis workspace isolation + HelixDB scoping. */
  hypoId: string
  /** Project name — drives workspace dir + HelixDB scoping. */
  projectId: string
  /** Run identifier — passed through runtimeContext for persistence + lineage. */
  runId: string
  /** High-score candidate case from Explore (active region + timestamp + wavelength). */
  candidateCase: {
    activeRegion: string
    timestamp: string
    wavelength: string
  }
  /**
   * Serializable model descriptor — reconstructed into a `LanguageModel` inside
   * `createLookerAgent` via `createModelFromConfig`.
   */
  modelConfig: ModelArg
  /**
   * Per-agent runtime config override (instructions / skillDirectories /
   * mcpServers). When present, its `modelConfig` takes priority over the
   * `modelConfig` field above and its non-model fields override the factory
   * defaults. Undefined → fully default behaviour (backward compat).
   */
  agentConfig?: AgentRuntimeConfig
  /**
   * Optional SSE chunk sink. When provided, each `UIMessageChunk` produced by
   * the agent's `fullStream` is forwarded to this callback.
   */
  emitChunk?: EmitChunk
  /**
   * Optional abort signal threaded into `agent.stream({abortSignal})`.
   */
  abortSignal?: AbortSignal
}

/**
 * Multimodal Looker workflow: cross-modal spatiotemporal alignment of a
 * high-score Explore candidate to raw FITS images + MP4 video clips.
 *
 * When `emitChunk` is supplied, every `UIMessageChunk` produced by the agent's
 * `fullStream` is forwarded to it.
 */
export async function lookerWorkflow(input: LookerWorkflowInput): Promise<EvidenceAlignment> {
  const agent = await createLookerAgent({
    modelConfig: input.agentConfig?.modelConfig ?? input.modelConfig,
    project: input.projectId,
    runId: input.runId,
    hypoId: input.hypoId,
    runtimeContext: {
      projectId: input.projectId,
      runId: input.runId,
      hypoId: input.hypoId,
    },
    ...(input.agentConfig?.instructions !== undefined
      ? { instructions: input.agentConfig.instructions }
      : {}),
    ...(input.agentConfig?.skillDirectories !== undefined
      ? { skillDirectories: input.agentConfig.skillDirectories }
      : {}),
    ...(input.agentConfig?.mcpServers !== undefined
      ? { mcpServers: input.agentConfig.mcpServers }
      : {}),
  })

  const prompt = `将假设 ${input.hypoId} 的高分候选案例对齐到原始 FITS 图像 + MP4 视频片段。

运行 id：${input.runId}
假设 id：${input.hypoId}
项目：${input.projectId}

候选案例（来自 Explore）：
- 活动区：${input.candidateCase.activeRegion}
- 时间戳：${input.candidateCase.timestamp}
- 波长：${input.candidateCase.wavelength}

步骤：
1. 先用 getEvidenceByHypothesis 检查该假设是否已有对齐证据（跳过重复工作）。
2. 调用 fitsAlign 工具，传入 (hypoId=${input.hypoId}, activeRegion=${input.candidateCase.activeRegion}, timestamp=${input.candidateCase.timestamp}, wavelength=${input.candidateCase.wavelength})。如果抛出 astropy/sunpy 安装提示，回退到通过 bash 直接运行对齐（用 sunpy Fido 查询 JSOC/VSO，写 align.py，运行 python3 align.py，读 stdout）。
3. 验证返回的 FITS 路径存在（readFile 或 ls），且 MP4 视频片段路径覆盖与 FITS 图像相同的（AR、时间窗口、波长、空间边界框）。如果无 MP4，videoClipPath 设为 null。
4. 从 FITS 头推导具体 spatialIndex 字符串（如"HPC (-420..-280, -180..-40) arcsec"），不能用模糊标签。
5. 用 addEvidence 持久化证据：hypoId=${input.hypoId}、type='support' 或 'contradict'（根据图像与假设预言是否一致）、content（物理摘要）、f1Score（透传）、fitsPaths、videoPath、createdAt=now ISO 8601。
6. 返回 EvidenceAlignment，含 hypoId=${input.hypoId}、fitsPaths[]、videoClipPath（可 null）、metadata {activeRegion, timestamp, wavelength, spatialIndex}。`

  const result = await agent.stream({
    messages: [{ role: 'user', content: prompt }],
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })

  await streamAgentOutput(result.fullStream, agent.tools, input.emitChunk)
  await persistAgentRun(input.projectId, input.runId, 'looker', prompt, result)
  const staticToolCalls = await result.staticToolCalls
  return extractSubmitResult(staticToolCalls) as EvidenceAlignment
}
