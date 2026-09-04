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
      kind: 'scientific.hypothesis',
      round: 1,
      hypothesis: {
        id: 'h-1',
        statement: '耦合加热',
        status: 'supported',
        evidenceStrengthGrade: 'strong',
      },
      adjudicated: true,
    })
    state = reduceScientificChunk(state, {
      type: 'custom',
      kind: 'scientific.verification-report',
      round: 1,
      report: {
        hypothesisId: 'h-1',
        round: 1,
        decision: 'supported',
        evidenceStrengthGrade: 'strong',
        evidenceStrengthSemantics: 'ordinal_evidence_grade_not_probability',
        supportTier: 'bounded_process_support',
        supportEvidenceIds: ['e-1'],
        validSupportEvidenceIds: ['e-1'],
        contradictionEvidenceIds: [],
        eventGroupIds: ['event-1'],
        rawDataFingerprints: ['raw-1'],
        observableFamilies: ['thermal_variability'],
        methodFamilies: ['timing-analysis'],
        analysisSplits: ['holdout'],
        attemptedAnalysisSplits: ['holdout'],
        coveredPredictionIds: ['h-1:prediction:1'],
        uncoveredPredictionIds: [],
        hasHoldoutEvidence: true,
        holdoutAttempted: true,
        hasQuantitativeEvidence: true,
        meetsEvidenceCriteria: true,
        supportGatePassed: true,
        eliminationGatePassed: false,
        eliminationEvidenceIds: [],
        coveredFalsificationConditionIds: [],
        decisiveFalsificationConditionIds: [],
        uncoveredFalsificationConditionIds: [],
        eliminationTaskIds: [],
        eliminationReasons: [],
        reasons: [],
        nextActions: [],
      },
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
        route: 'explorer',
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
    expect(state.hypotheses[0]?.status).toBe('supported')
    expect(state.verificationReports[0]).toMatchObject({
      hypothesisId: 'h-1',
      supportGatePassed: true,
      supportTier: 'bounded_process_support',
    })
    expect(state.evidence[0]).toMatchObject({
      status: 'support',
      provenance: { processingRunId: 'processing-1', deterministic: true },
    })
    expect(state.validationTasks[0]).toMatchObject({
      route: 'explorer',
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
      node: 'librarian.generate',
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
      nextRoute: 'explorer',
    })

    expect(state.orchestration.nodes).toEqual([
      { node: 'librarian.generate', state: 'running', round: 1 },
    ])
    expect(state.orchestration.agents).toEqual([
      {
        agentId: 'looker-source-audit',
        label: '观测质控智能体：数据来源审计',
        state: 'running',
        round: 1,
      },
    ])
    expect(state.orchestration.latestRoute).toEqual({
      round: 1,
      continue: true,
      reason: 'new evidence',
      nextRoute: 'explorer',
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
          { taskId: 't-final', route: 'explorer', status: 'planned', objective: 'validate' },
        ],
        corrections: [
          { correctionId: 'c-final', stage: 'oracle', status: 'passed', message: 'checked' },
        ],
        verificationReports: [
          {
            hypothesisId: 'h-final',
            round: 2,
            decision: 'candidate',
            supportGatePassed: false,
          },
        ],
        closureReports: [
          {
            hypothesisId: 'h-final',
            status: 'partial',
            runDisposition: 'deferred_requires_data',
            dispositionReason: 'requires spectroscopy',
            localDataSufficient: false,
            blockingTaskIds: ['t-final'],
          },
        ],
        scientificStatus: 'needs_data',
        closureStatus: 'partial',
        outcomeProfile: {
          candidate: 1,
          supported: 0,
          provisionallySupported: 0,
          contradicted: 0,
          deferredRequiresData: 0,
          uncertain: 0,
          eliminated: 0,
          revised: 0,
        },
        workflowClosure: {
          status: 'complete',
          allHypothesesDisposed: true,
          noExecutableTasksRemaining: true,
          noUnassessedTasksRemaining: true,
          terminalHypothesisCount: 1,
          totalHypothesisCount: 1,
          dispositionCounts: { deferred_requires_data: 1 },
          reasons: [],
        },
        operationalClosure: {
          status: 'complete',
          agentFailures: [],
          failedTaskIds: [],
          unresolvedErrorCorrectionCount: 0,
          dataIntegrityErrors: [],
          reasons: [],
        },
        hypothesisCoverage: {
          mode: 'open_world',
          exhaustiveClaim: false,
          fixedMechanismCount: false,
          candidateCount: 1,
          retrievalSourceCount: 3,
          retrievedMechanismFamilies: ['thermal-nonequilibrium'],
          representedMechanismFamilies: ['thermal-nonequilibrium'],
          unrepresentedMechanismFamilies: [],
          residualAlternativeAllowed: true,
          limitations: ['finite retrieval is not exhaustive'],
        },
      },
    })

    expect(state.round).toBe(2)
    expect(state.hypotheses[0]?.id).toBe('h-final')
    expect(state.evidence[0]?.evidenceId).toBe('e-final')
    expect(state.validationTasks[0]?.taskId).toBe('t-final')
    expect(state.corrections[0]?.correctionId).toBe('c-final')
    expect(state.verificationReports[0]?.hypothesisId).toBe('h-final')
    expect(state.scientificStatus).toBe('needs_data')
    expect(state.closureStatus).toBe('partial')
    expect(state.outcomeProfile?.candidate).toBe(1)
    expect(state.closureReports[0]?.runDisposition).toBe('deferred_requires_data')
    expect(state.workflowClosure?.status).toBe('complete')
    expect(state.operationalClosure?.status).toBe('complete')
    expect(state.hypothesisCoverage?.fixedMechanismCount).toBe(false)
    expect(state.conclusion).toBe('bounded conclusion')
  })
})
