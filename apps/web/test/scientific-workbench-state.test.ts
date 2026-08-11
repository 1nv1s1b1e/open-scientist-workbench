import { describe, expect, it } from 'vite-plus/test'
import { reduceScientificChunk, emptyScientificWorkbenchState } from '../src/lib/workbench/state.ts'

describe('scientific workbench state replay', () => {
  it('replays phenomenon, hypothesis, evidence, correction, and task events', () => {
    let state = emptyScientificWorkbenchState()
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.phenomenon',
      phenomenon: {
        phenomenonId: 'ar-1',
        title: '活动区短时增亮',
        description: '多波段观测现象',
        observations: [],
      },
      inputDigest: 'digest-1',
    })
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.hypothesis',
      round: 1,
      hypothesis: { id: 'h-1', statement: '耦合加热', status: 'candidate' },
    })
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.evidence',
      round: 1,
      evidence: {
        evidenceId: 'e-1',
        hypothesisId: 'h-1',
        status: 'support',
        claim: '可复现诊断支持该预测',
        provenance: {
          processingRunId: 'processing-1',
          dataSnapshotIds: ['snapshot-1'],
          artifactIds: ['metrics-1', 'figure-1'],
          generatedBy: 'coronal-diagnostics-v1',
          deterministic: true,
        },
      },
    })
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.validation-task',
      round: 1,
      task: {
        taskId: 'task-1',
        executorId: 'coronal-wave-validation',
        type: 'analysis',
        route: 'B',
        status: 'completed',
        objective: '完成时序分析',
        requiredSourceIds: ['local-coronal-observations'],
        resultEvidenceIds: ['e-1'],
      },
    })
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.self-correction',
      round: 1,
      stage: 'B-C-factual-check',
      status: 'passed',
      message: '来源边界已保留',
    })
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.processing-result',
      round: 1,
      processingRunId: 'processing-1',
      snapshotId: 'snapshot-1',
      caseId: 'ar11158-window',
      caseLabel: 'NOAA 11158 多波段窗口',
      mode: 'discovery',
      usedObservationCount: 96,
      baselineCaseLabel: 'NOAA 11158 背景窗口',
      diagnostics: { wave: { observableStatus: 'support', crossChannelCorrelation: 0.7 } },
      metricsArtifactId: 'metrics-1',
      figureArtifactId: 'figure-1',
      figureUrl: '/api/projects/test/artifacts/figure-1/content',
      limitations: ['不包含能量闭合'],
    })

    expect(state.phenomenon?.phenomenonId).toBe('ar-1')
    expect(state.hypotheses).toHaveLength(1)
    expect(state.evidence[0]).toMatchObject({
      status: 'support',
      provenance: { processingRunId: 'processing-1', deterministic: true },
    })
    expect(state.validationTasks[0]).toMatchObject({
      route: 'B',
      executorId: 'coronal-wave-validation',
      type: 'analysis',
      requiredSourceIds: ['local-coronal-observations'],
      resultEvidenceIds: ['e-1'],
    })
    expect(state.corrections[0]?.status).toBe('passed')
    expect(state.processingResults[0]).toMatchObject({
      processingRunId: 'processing-1',
      usedObservationCount: 96,
    })
  })

  it('replaces duplicate entities during SSE replay', () => {
    let state = emptyScientificWorkbenchState()
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.round-summary',
      round: 1,
      conclusion: '第一轮',
      evidenceSummary: { support: 0, contradict: 0, unknown: 1 },
    })
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.round-summary',
      round: 2,
      conclusion: '第二轮',
      evidenceSummary: { support: 1, contradict: 0, unknown: 0 },
    })
    expect(state.round).toBe(2)
    expect(state.conclusion).toBe('第二轮')
    expect(state.roundSummaries).toHaveLength(2)
  })

  it('replays the LangGraph node, parallel evidence-agent, and route events', () => {
    let state = emptyScientificWorkbenchState()
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.node-state',
      node: 'A.generate',
      state: 'running',
      round: 1,
    })
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.agent-state',
      agentId: 'looker-source-audit',
      label: 'Looker：数据来源审计',
      state: 'running',
      round: 1,
    })
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.route',
      round: 1,
      continue: true,
      reason: 'new evidence',
      nextRoute: 'B',
    })

    expect(state.orchestration.nodes).toEqual([{ node: 'A.generate', state: 'running', round: 1 }])
    expect(state.orchestration.agents).toEqual([
      {
        agentId: 'looker-source-audit',
        label: 'Looker：数据来源审计',
        state: 'running',
        round: 1,
      },
    ])
    expect(state.orchestration.latestRoute).toEqual({
      round: 1,
      continue: true,
      reason: 'new evidence',
      nextRoute: 'B',
    })
  })
  it('hydrates saved entities from the final completion event', () => {
    let state = emptyScientificWorkbenchState()
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.correction',
      correction: {
        correctionId: 'c-1',
        stage: 'B-C-factual-check',
        severity: 'warning',
        status: 'corrected',
        message: 'source boundary corrected',
      },
    })
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.loop-complete',
      result: {
        status: 'completed',
        totalRounds: 2,
        conclusion: 'bounded conclusion',
        terminationReason: 'max_rounds_reached',
        hypotheses: [{ id: 'h-final', statement: 'final hypothesis', status: 'candidate' }],
        evidence: [
          {
            evidenceId: 'e-final',
            hypothesisId: 'h-final',
            status: 'unknown',
            claim: 'bounded evidence',
          },
        ],
        validationTasks: [
          { taskId: 't-final', route: 'B', status: 'planned', objective: 'validate' },
        ],
        corrections: [
          { correctionId: 'c-final', stage: 'C', status: 'passed', message: 'checked' },
        ],
      },
    })

    expect(state.round).toBe(2)
    expect(state.hypotheses[0]?.id).toBe('h-final')
    expect(state.evidence[0]?.evidenceId).toBe('e-final')
    expect(state.validationTasks[0]?.taskId).toBe('t-final')
    expect(state.corrections[0]?.correctionId).toBe('c-final')
    expect(state.conclusion).toBe('bounded conclusion')
  })
})
