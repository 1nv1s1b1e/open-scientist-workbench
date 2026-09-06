'use client'

import {
  BookOpenCheck,
  Bot,
  Check,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  DatabaseZap,
  FileSearch,
  GitBranch,
  ListTree,
  ShieldAlert,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { UIMessageChunk } from '@/lib/types/sse-events'
import type { ScientificWorkbenchState } from '@/lib/workbench/state'
import {
  summarizeScientificTrace,
  validationTaskTraceStatus,
} from '@/lib/workbench/scientific-trace-data'

type TraceCategory =
  | 'input'
  | 'model'
  | 'stage'
  | 'agent'
  | 'tool'
  | 'processing'
  | 'evidence'
  | 'correction'
  | 'task'
  | 'route'
  | 'result'
type TraceStatus = 'idle' | 'queued' | 'running' | 'completed' | 'skipped' | 'failed'
type TraceStage =
  | 'librarian'
  | 'self-correction-i'
  | 'surveyor'
  | 'explorer'
  | 'self-correction-ii'
  | 'oracle'
  | 'prometheus'

type TraceDetail = { label: string; value: unknown }

interface TraceEntry {
  id: string
  category: TraceCategory
  status: TraceStatus
  stage?: TraceStage
  round?: number
  title: string
  summary: string
  details?: TraceDetail[]
}

const COPY = {
  all: '\u5168\u90e8',
  model: '\u6a21\u578b\u6458\u8981',
  tools: '\u5de5\u5177\u8c03\u7528',
  agents: '\u667a\u80fd\u4f53',
  evidence: '\u8bc1\u636e',
  corrections: '\u6821\u6b63',
  processing: '\u6570\u636e\u5904\u7406',
  input: '\u8f93\u5165\u73b0\u8c61',
  modelOutput: '\u6a21\u578b\u5bf9\u5916\u8f93\u51fa',
  modelRun: '\u6a21\u578b\u8fd0\u884c',
  modelConfig: '\u6a21\u578b\u4e0e\u601d\u8003\u914d\u7f6e',
  tokenUsage: 'Token \u7528\u91cf',
  generatedHypothesis: '\u5019\u9009\u5047\u8bbe',
  evidenceStatus: '\u8bc1\u636e\u5224\u65ad',
  correction: '\u4e8b\u5b9e\u6821\u6b63',
  roundSummary: '\u672c\u8f6e\u7ed3\u8bba',
  nextValidation: '\u4e0b\u4e00\u6b65\u9a8c\u8bc1',
  routing: '\u95ed\u73af\u8def\u7531',
  runComplete: '\u8fd0\u884c\u5b8c\u6210',
  inputDetails: '\u8f93\u5165\u5185\u5bb9',
  predictions: '\u53ef\u68c0\u9a8c\u9884\u6d4b',
  falsifiers: '\u8bc1\u4f2a\u6761\u4ef6',
  sources: '\u5173\u8054\u6765\u6e90',
  observation: '\u89c2\u6d4b\u6458\u8981',
  provenance: '\u5904\u7406\u6eaf\u6e90',
  limitations: '\u6570\u636e\u8fb9\u754c',
  action: '\u6821\u6b63\u52a8\u4f5c',
  affected: '\u53d7\u5f71\u54cd\u5bf9\u8c61',
  outcomes: '\u533a\u5206\u6027\u7ed3\u679c',
  continue: '\u662f\u5426\u7ee7\u7eed',
  completed: '\u5df2\u5b8c\u6210',
  running: '\u8fd0\u884c\u4e2d',
  queued: '\u5df2\u6392\u961f',
  skipped: '\u5df2\u8df3\u8fc7',
  failed: '\u5931\u8d25',
  idle: '\u7b49\u5f85\u4e2d',
  system: '\u7cfb\u7edf\u4e8b\u4ef6',
  toolPrefix: '\u5de5\u5177\uff1a',
  toolFailedPrefix: '\u5de5\u5177\u5931\u8d25\uff1a',
  toolStart: '\u7b49\u5f85\u5de5\u5177\u8f93\u5165\u3002',
  toolInput: '\u5df2\u8bb0\u5f55\u5de5\u5177\u53c2\u6570\uff0c\u6b63\u5728\u6267\u884c\u3002',
  toolOutput:
    '\u5de5\u5177\u5df2\u8fd4\u56de\u7ed3\u679c\uff0c\u5df2\u53bb\u9664\u654f\u611f\u5b57\u6bb5\u3002',
  agentComplete: '\u5df2\u5b8c\u6210\u8be5\u667a\u80fd\u4f53\u7684\u5de5\u4f5c\u3002',
  agentSkipped:
    '\u5f53\u524d\u6570\u636e\u6761\u4ef6\u4e0d\u6ee1\u8db3\uff0c\u672c\u6b65\u672a\u6267\u884c\u3002',
  stageRunning: '\u8be5\u7ed3\u70b9\u5f00\u59cb\u5904\u7406\u3002',
  stageComplete:
    '\u8be5\u7ed3\u70b9\u5df2\u5b8c\u6210\u5e76\u7559\u4e0b\u7ed3\u6784\u5316\u4ea7\u7269\u3002',
  noTrace: '\u6682\u65e0\u53ef\u56de\u653e\u7684\u8fd0\u884c\u4e8b\u4ef6',
  noTraceDescription:
    '\u65b0\u5efa\u4e00\u6b21\u8fd0\u884c\u540e\uff0c\u8fd9\u91cc\u4f1a\u6309\u65f6\u95f4\u8bb0\u5f55\u6a21\u578b\u5bf9\u5916\u6458\u8981\u3001\u5de5\u5177\u884c\u4e3a\u3001\u8bc1\u636e\u548c\u6821\u6b63\u3002',
  heading: '\u53ef\u5ba1\u8ba1\u6267\u884c\u8f68\u8ff9',
  lead: '\u67e5\u770b\u6bcf\u4e2a\u9636\u6bb5\u4e3a\u4ec0\u4e48\u89e6\u53d1\u3001\u6a21\u578b\u5bf9\u5916\u7ed9\u51fa\u4e86\u4ec0\u4e48\u4f9d\u636e\u3001\u6267\u884c\u4e86\u54ea\u4e9b\u5de5\u5177\u4ee5\u53ca\u6700\u7ec8\u5982\u4f55\u8def\u7531\u3002\u8fd9\u662f\u4e00\u4efd\u53ef\u8ffd\u6eaf\u7684\u79d1\u7814\u5de5\u4f5c\u53f0\u8d26\uff0c\u4e0d\u5c55\u793a\u9690\u85cf\u601d\u7ef4\u8349\u7a3f\u3002',
  live: '\u5b9e\u65f6\u6d41\u4e2d',
  replay: '\u5df2\u4ece\u8fd0\u884c\u8bb0\u5f55\u56de\u653e',
  noRun: '\u5c1a\u672a\u8fd0\u884c',
  modelEvents: '\u6a21\u578b\u8bb0\u5f55',
  modelCalls: '\u771f\u5b9e\u6a21\u578b\u8c03\u7528',
  reasoningTokens: '思考 Token 用量',
  processingRuns: '\u786e\u5b9a\u6027\u5904\u7406',
  toolEvents: '\u5de5\u5177\u4e8b\u4ef6',
  completedEvents: '\u5df2\u5b8c\u6210',
  evidenceAndCorrection: '\u8bc1\u636e / \u6821\u6b63',
  details: '\u67e5\u770b\u8be6\u60c5',
  hide: '\u6536\u8d77\u8be6\u60c5',
  resultCounts: '\u7ed3\u6784\u5316\u4ea7\u7269',
  savedResult: '\u5df2\u4fdd\u5b58\u7684\u9879\u76ee\u7ed3\u679c',
  savedResultDescription:
    '\u8be6\u7ec6\u7684\u5de5\u5177\u8c03\u7528\u4f1a\u5728\u4e0b\u6b21\u8fd0\u884c\u540e\u5199\u5165\u8f68\u8ff9\u3002',
  notAvailable: '\u672a\u63d0\u4f9b',
} as const

const FILTERS: Array<{ id: 'all' | TraceCategory; label: string }> = [
  { id: 'all', label: COPY.all },
  { id: 'model', label: COPY.model },
  { id: 'tool', label: COPY.tools },
  { id: 'processing', label: COPY.processing },
  { id: 'agent', label: COPY.agents },
  { id: 'evidence', label: COPY.evidence },
  { id: 'correction', label: COPY.corrections },
]

const SENSITIVE_KEY = /(?:api[-_]?key|authorization|credential|password|secret|token)/i
const SENSITIVE_VALUE = /(?:\bsk-[A-Za-z0-9_-]{8,}\b|\bBearer\s+[A-Za-z0-9._-]{8,}\b)/gi

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function cleanText(value: unknown, maximum: number = 900): string {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(SENSITIVE_VALUE, '[redacted]').replace(/\s+/g, ' ').trim()
  return normalized.length > maximum ? `${normalized.slice(0, maximum)}...` : normalized
}

function redact(value: unknown, depth: number = 0): unknown {
  if (depth > 3) return '[truncated]'
  if (typeof value === 'string') return cleanText(value, 1400)
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => redact(item, depth + 1))
  const record = asRecord(value)
  if (!record) return value
  return Object.fromEntries(
    Object.entries(record)
      .slice(0, 24)
      .map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1),
      ]),
  )
}

function formatValue(value: unknown): string {
  const safe = redact(value)
  if (typeof safe === 'string') return safe || COPY.notAvailable
  try {
    return JSON.stringify(safe, null, 2) ?? COPY.notAvailable
  } catch {
    return COPY.notAvailable
  }
}

const TRACE_STAGES: readonly TraceStage[] = [
  'librarian',
  'self-correction-i',
  'surveyor',
  'explorer',
  'self-correction-ii',
  'oracle',
  'prometheus',
]

/** 兼容 v1.0 冻结运行记录里的 A–D 阶段码与旧节点名。 */
const TRACE_STAGE_ALIASES: Record<string, TraceStage> = {
  A: 'librarian',
  B: 'explorer',
  C: 'oracle',
  D: 'prometheus',
  'librarian.generate': 'librarian',
  'self-correction-i.verify': 'self-correction-i',
  'surveyor.analyze': 'surveyor',
  'explorer.analyze': 'explorer',
  'explorer.dispatch': 'explorer',
  'explorer.worker': 'explorer',
  'explorer.aggregate': 'explorer',
  'self-correction-ii.verify': 'self-correction-ii',
  'oracle.verify': 'oracle',
  'oracle.synthesize': 'oracle',
  'prometheus.plan': 'prometheus',
  'prometheus.route': 'prometheus',
}

function stageFrom(value: unknown): TraceStage | undefined {
  if (typeof value !== 'string') return undefined
  const key = value.trim()
  if ((TRACE_STAGES as readonly string[]).includes(key)) return key as TraceStage
  return TRACE_STAGE_ALIASES[key] ?? TRACE_STAGE_ALIASES[key.charAt(0).toUpperCase()]
}

function stageLabel(stage?: TraceStage): string {
  if (stage === 'librarian') return 'Librarian / 假设生成'
  if (stage === 'self-correction-i') return '自校正 I / 假设评估'
  if (stage === 'surveyor') return 'Surveyor / 粗粒度分析'
  if (stage === 'explorer') return 'Explorer / 证据工作'
  if (stage === 'self-correction-ii') return '自校正 II / 事实核验'
  if (stage === 'oracle') return 'Oracle / 综合推理'
  if (stage === 'prometheus') return 'Prometheus / 验证规划'
  return COPY.system
}

function statusLabel(status: TraceStatus): string {
  const labels: Record<TraceStatus, string> = {
    idle: COPY.idle,
    queued: COPY.queued,
    running: COPY.running,
    completed: COPY.completed,
    skipped: COPY.skipped,
    failed: COPY.failed,
  }
  return labels[status]
}

function categoryLabel(category: TraceCategory): string {
  const labels: Record<TraceCategory, string> = {
    input: COPY.input,
    model: COPY.model,
    stage: '\u9636\u6bb5',
    agent: COPY.agents,
    tool: '\u5de5\u5177',
    processing: COPY.processing,
    evidence: COPY.evidence,
    correction: COPY.corrections,
    task: '\u9a8c\u8bc1\u4efb\u52a1',
    route: '\u8def\u7531',
    result: '\u7ed3\u679c',
  }
  return labels[category]
}

function asStatus(value: unknown): TraceStatus {
  return value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'skipped' ||
    value === 'failed'
    ? value
    : 'idle'
}

function appendOrUpdate(entries: TraceEntry[], entry: TraceEntry): void {
  const index = entries.findIndex((item) => item.id === entry.id)
  if (index < 0) entries.push(entry)
  else entries[index] = { ...entries[index], ...entry }
}

function toolEntry(
  chunk: UIMessageChunk,
  index: number,
  toolNames: Map<string, string>,
): TraceEntry | null {
  const payload = chunk as unknown as Record<string, unknown>
  const type = String(payload.type ?? '')
  if (!type.startsWith('tool-')) return null
  const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : `tool-${index}`
  const providedToolName = typeof payload.toolName === 'string' ? payload.toolName : null
  if (providedToolName) toolNames.set(toolCallId, providedToolName)
  const toolName = providedToolName ?? toolNames.get(toolCallId) ?? '\u672a\u547d\u540d\u5de5\u5177'
  const stage = stageFrom(payload.stage)
  const id = `tool:${toolCallId}`
  if (type === 'tool-input-start') {
    return {
      id,
      category: 'tool',
      status: 'running',
      stage,
      title: `${COPY.toolPrefix}${toolName}`,
      summary: COPY.toolStart,
    }
  }
  if (type === 'tool-input-available') {
    return {
      id,
      category: 'tool',
      status: 'running',
      stage,
      title: `${COPY.toolPrefix}${toolName}`,
      summary: COPY.toolInput,
      details: [{ label: '\u8f93\u5165\u53c2\u6570', value: redact(payload.input) }],
    }
  }
  if (type === 'tool-output-available') {
    return {
      id,
      category: 'tool',
      status: 'completed',
      stage,
      title: `${COPY.toolPrefix}${toolName}`,
      summary: COPY.toolOutput,
      details: [{ label: '\u8fd4\u56de\u7ed3\u679c', value: redact(payload.output) }],
    }
  }
  if (type === 'tool-input-error' || type === 'tool-output-error') {
    return {
      id,
      category: 'tool',
      status: 'failed',
      stage,
      title: `${COPY.toolFailedPrefix}${toolName}`,
      summary:
        cleanText(payload.errorText) ||
        '\u5de5\u5177\u672a\u80fd\u8fd4\u56de\u53ef\u7528\u7ed3\u679c\u3002',
      details:
        payload.input === undefined
          ? undefined
          : [{ label: '\u8f93\u5165\u53c2\u6570', value: redact(payload.input) }],
    }
  }
  return null
}

function customEntry(chunk: UIMessageChunk, index: number): TraceEntry | null {
  if (chunk.type !== 'custom') return null
  const payload = chunk as unknown as Record<string, unknown>
  const kind = typeof payload.kind === 'string' ? payload.kind : ''
  const round = typeof payload.round === 'number' ? payload.round : undefined

  if (kind === 'scientific.phenomenon') {
    const phenomenon = asRecord(payload.phenomenon)
    return {
      id: `input:${String(phenomenon?.phenomenonId ?? index)}`,
      category: 'input',
      status: 'completed',
      stage: 'librarian',
      round,
      title: COPY.input,
      summary:
        cleanText(phenomenon?.title) ||
        '\u5df2\u8bb0\u5f55\u5f53\u524d\u79d1\u5b66\u73b0\u8c61\u3002',
      details: phenomenon ? [{ label: COPY.inputDetails, value: phenomenon }] : undefined,
    }
  }

  if (kind === 'scientific.reasoning-summary') {
    return {
      id: `model-summary:${String(payload.stage ?? 'A')}:${round ?? 0}:${index}`,
      category: 'model',
      status: 'completed',
      stage: stageFrom(payload.stage),
      round,
      title: cleanText(payload.title) || COPY.model,
      summary:
        cleanText(payload.summary) ||
        '\u6a21\u578b\u672a\u8fd4\u56de\u53ef\u5c55\u793a\u7684\u6458\u8981\u3002',
      details:
        payload.hypothesisCount === undefined
          ? undefined
          : [{ label: '\u5019\u9009\u5047\u8bbe\u6570', value: payload.hypothesisCount }],
    }
  }

  if (kind === 'scientific.retrieval') {
    return {
      id: `retrieval:${round ?? 0}:${index}`,
      category: 'tool',
      status: payload.status === 'failed' ? 'failed' : 'completed',
      stage: 'librarian',
      round,
      title: '\u8d44\u6599\u68c0\u7d22\u6c47\u603b',
      summary:
        cleanText(payload.message) ||
        '\u5df2\u5b8c\u6210\u6587\u732e\u3001\u5386\u53f2\u5047\u8bbe\u4e0e\u672c\u5730\u89c2\u6d4b\u68c0\u7d22\u3002',
      details: [
        {
          label: '\u68c0\u7d22\u7ed3\u679c',
          value: {
            sourceCount: payload.sourceCount,
            paperCount: payload.paperCount,
            localCaseCount: payload.localCaseCount,
            tools: payload.tools,
          },
        },
      ],
    }
  }

  if (kind === 'scientific.model-run') {
    const usage = asRecord(payload.usage)
    const thinkingEnabled = payload.thinkingEnabled === true
    const reasoningTokens = typeof usage?.reasoningTokens === 'number' ? usage.reasoningTokens : 0
    return {
      id: `model-run:${String(payload.agentId ?? payload.role ?? index)}:${round ?? 0}:${index}`,
      category: 'model',
      status: 'completed',
      stage: stageFrom(payload.stage),
      round,
      title: `${COPY.modelRun}\uff1a${cleanText(payload.agentId) || cleanText(payload.role) || COPY.system}`,
      summary: thinkingEnabled
        ? reasoningTokens > 0
          ? `\u5df2\u542f\u7528\u6a21\u578b\u601d\u8003\uff0c\u63d0\u4f9b\u5546\u8bb0\u5f55 ${reasoningTokens} \u4e2a reasoning token\u3002`
          : '\u5df2\u8bf7\u6c42\u6a21\u578b\u601d\u8003\uff1b\u5f53\u524d\u63d0\u4f9b\u5546\u672a\u8fd4\u56de reasoning token \u8ba1\u6570\uff0c\u4ec5\u5c55\u793a\u53ef\u6838\u9a8c\u7684\u516c\u5f00\u6458\u8981\u3002'
        : '\u672c\u6b21\u4e3a\u666e\u901a\u6a21\u578b\u751f\u6210\uff0c\u672a\u542f\u7528\u6269\u5c55\u601d\u8003\u3002',
      details: [
        {
          label: COPY.modelConfig,
          value: {
            provider: payload.provider,
            model: payload.model,
            apiMode: payload.apiMode,
            thinkingLevel: payload.thinkingLevel,
            steps: payload.steps,
            finishReason: payload.finishReason,
          },
        },
        { label: COPY.tokenUsage, value: usage ?? {} },
      ],
    }
  }

  if (kind === 'scientific.node-state') {
    const node = typeof payload.node === 'string' ? payload.node : '\u672a\u547d\u540d\u7ed3\u70b9'
    const status = asStatus(payload.state)
    return {
      id: `node:${node}:${round ?? 0}:${index}`,
      category: 'stage',
      status,
      stage: stageFrom(node),
      round,
      title: stageLabel(stageFrom(node)),
      summary: status === 'running' ? COPY.stageRunning : COPY.stageComplete,
    }
  }

  if (kind === 'scientific.agent-state') {
    const agentId =
      typeof payload.agentId === 'string' ? payload.agentId : '\u672a\u547d\u540d\u667a\u80fd\u4f53'
    const status = asStatus(payload.state)
    return {
      id: `agent:${agentId}:${round ?? 0}:${index}`,
      category: 'agent',
      status,
      stage: 'explorer',
      round,
      title: cleanText(payload.label) || agentId,
      summary:
        cleanText(payload.message) ||
        (status === 'skipped' ? COPY.agentSkipped : COPY.agentComplete),
      details: [
        { label: 'agent id', value: agentId },
        {
          label: '\u6267\u884c\u65b9\u5f0f',
          value:
            payload.executionKind === 'model'
              ? '\u6a21\u578b\u5ba1\u9605\uff08\u8bfb\u53d6\u524d\u5e8f\u7ed3\u6784\u5316\u8bc1\u636e\uff09'
              : '\u786e\u5b9a\u6027\u8ba1\u7b97 / \u89c4\u5219\u6838\u9a8c',
        },
      ],
    }
  }

  if (kind === 'scientific.hypothesis') {
    const hypothesis = asRecord(payload.hypothesis)
    return {
      id: `hypothesis:${String(hypothesis?.id ?? index)}`,
      category: 'model',
      status: 'completed',
      stage: 'librarian',
      round,
      title: COPY.generatedHypothesis,
      summary:
        cleanText(hypothesis?.statement) || '\u672a\u63d0\u4f9b\u5047\u8bbe\u8868\u8ff0\u3002',
      details: hypothesis
        ? [
            { label: COPY.predictions, value: hypothesis.predictions },
            { label: COPY.falsifiers, value: hypothesis.falsificationConditions },
            { label: COPY.sources, value: hypothesis.sourceIds },
          ]
        : undefined,
    }
  }

  if (kind === 'scientific.evidence') {
    const evidence = asRecord(payload.evidence)
    const evidenceStatus = typeof evidence?.status === 'string' ? evidence.status : 'unknown'
    const verdict =
      evidenceStatus === 'support'
        ? '\u652f\u6301'
        : evidenceStatus === 'contradict'
          ? '\u53cd\u4f8b'
          : '\u672a\u5b9a'
    return {
      id: `evidence:${String(evidence?.evidenceId ?? index)}`,
      category: 'evidence',
      status: 'completed',
      stage: 'explorer',
      round,
      title: `${COPY.evidenceStatus}\uff1a${verdict}`,
      summary:
        cleanText(evidence?.claim) ||
        '\u672a\u5f62\u6210\u53ef\u6838\u9a8c\u7684\u8bc1\u636e\u5224\u65ad\u3002',
      details: evidence
        ? [
            { label: COPY.observation, value: evidence.observed },
            {
              label: COPY.provenance,
              value: { method: evidence.method, sourceIds: evidence.sourceIds },
            },
            { label: COPY.limitations, value: evidence.limitations },
          ]
        : undefined,
    }
  }

  if (kind === 'scientific.processing-result') {
    const processingRunId = cleanText(payload.processingRunId) || String(index)
    const mode =
      payload.mode === 'validation'
        ? '\u9a8c\u8bc1\u8f6e\u590d\u6d4b'
        : '\u63a2\u7d22\u8f6e\u5206\u6790'
    const usedObservationCount =
      typeof payload.usedObservationCount === 'number' ? payload.usedObservationCount : 0
    return {
      id: `processing:${processingRunId}`,
      category: 'processing',
      status: 'completed',
      stage: 'explorer',
      round,
      title: `\u786e\u5b9a\u6027\u5904\u7406\uff1a${cleanText(payload.caseLabel) || processingRunId}`,
      summary: `${mode}\uff0c\u5b9e\u9645\u8bfb\u53d6 ${usedObservationCount} \u6761\u89c2\u6d4b\uff1b\u5904\u7406\u8fd0\u884c ${processingRunId}\u3002`,
      details: [
        { label: '\u8bca\u65ad\u6307\u6807', value: payload.diagnostics },
        {
          label: COPY.provenance,
          value: {
            processingRunId: payload.processingRunId,
            snapshotId: payload.snapshotId,
            metricsArtifactId: payload.metricsArtifactId,
            figureArtifactId: payload.figureArtifactId,
            baselineCaseLabel: payload.baselineCaseLabel,
          },
        },
        { label: COPY.limitations, value: payload.limitations },
      ],
    }
  }

  if (kind === 'scientific.self-correction' || kind === 'scientific.correction') {
    const correction = asRecord(payload.correction) ?? payload
    return {
      id: `correction:${String(correction.correctionId ?? index)}`,
      category: 'correction',
      status: correction.severity === 'error' ? 'failed' : 'completed',
      stage: stageFrom(correction.stage),
      round: typeof correction.round === 'number' ? correction.round : round,
      title: `${COPY.correction}\uff1a${cleanText(correction.stage) || COPY.system}`,
      summary:
        cleanText(correction.message) ||
        '\u7cfb\u7edf\u5df2\u5bf9\u4e8b\u5b9e\u8fb9\u754c\u8fdb\u884c\u6821\u9a8c\u3002',
      details: [
        { label: COPY.action, value: correction.action },
        { label: COPY.affected, value: correction.affectedIds },
      ],
    }
  }

  if (kind === 'scientific.round-summary') {
    return {
      id: `summary:${round ?? index}`,
      category: 'result',
      status: 'completed',
      stage: 'oracle',
      round,
      title: COPY.roundSummary,
      summary:
        cleanText(payload.conclusion) ||
        '\u672c\u8f6e\u672a\u5f62\u6210\u53ef\u7528\u7ed3\u8bba\u3002',
      details:
        payload.evidenceSummary === undefined
          ? undefined
          : [{ label: COPY.evidenceStatus, value: payload.evidenceSummary }],
    }
  }

  if (kind === 'scientific.validation-task') {
    const task = asRecord(payload.task)
    const taskStatus = validationTaskTraceStatus(task?.status)
    return {
      id: `task:${String(task?.taskId ?? index)}`,
      category: 'task',
      status: taskStatus,
      stage: 'prometheus',
      round,
      title: COPY.nextValidation,
      summary: cleanText(task?.objective) || '\u672a\u63d0\u4f9b\u9a8c\u8bc1\u76ee\u6807\u3002',
      details: task
        ? [
            { label: '\u6267\u884c\u5668', value: task.executorId ?? '\u672a\u7ed1\u5b9a' },
            { label: COPY.outcomes, value: task.discriminatingOutcomes },
            { label: COPY.sources, value: task.requiredSourceIds },
            { label: '\u7ed3\u679c\u8bc1\u636e', value: task.resultEvidenceIds },
          ]
        : undefined,
    }
  }

  if (kind === 'scientific.route') {
    const nextRoute = cleanText(payload.nextRoute) || 'END'
    return {
      id: `route:${round ?? index}`,
      category: 'route',
      status: 'completed',
      stage: 'prometheus',
      round,
      title: `${COPY.routing}\uff1a${nextRoute}`,
      summary:
        cleanText(payload.reason) ||
        '\u5f53\u524d\u8f6e\u5df2\u5b8c\u6210\u8def\u7531\u5224\u65ad\u3002',
      details: [{ label: COPY.continue, value: payload.continue === true }],
    }
  }

  if (kind === 'scientific.loop-complete') {
    const result = asRecord(payload.result)
    return {
      id: `result:${String(result?.runId ?? index)}`,
      category: 'result',
      status: result?.status === 'failed' ? 'failed' : 'completed',
      round: typeof result?.totalRounds === 'number' ? result.totalRounds : round,
      title: COPY.runComplete,
      summary: cleanText(result?.conclusion) || '\u672c\u6b21\u8fd0\u884c\u5df2\u7ed3\u675f\u3002',
      details: result
        ? [
            { label: '\u7ec8\u6b62\u539f\u56e0', value: result.terminationReason },
            {
              label: COPY.resultCounts,
              value: {
                hypotheses: Array.isArray(result.hypotheses) ? result.hypotheses.length : 0,
                evidence: Array.isArray(result.evidence) ? result.evidence.length : 0,
                validationTasks: Array.isArray(result.validationTasks)
                  ? result.validationTasks.length
                  : 0,
              },
            },
          ]
        : undefined,
    }
  }

  return null
}

export function buildScientificTrace(chunks: readonly UIMessageChunk[]): TraceEntry[] {
  const entries: TraceEntry[] = []
  const toolNames = new Map<string, string>()
  for (const [index, chunk] of chunks.entries()) {
    const payload = chunk as unknown as Record<string, unknown>
    const type = String(payload.type ?? '')
    if (type.startsWith('reasoning-')) continue

    if (type === 'text-delta') {
      const delta = cleanText(payload.delta ?? payload.text, 1600)
      if (delta) {
        const id = 'model-visible-output'
        const existing = entries.find((entry) => entry.id === id)
        if (existing) existing.summary = cleanText(`${existing.summary} ${delta}`, 1800)
        else
          entries.push({
            id,
            category: 'model',
            status: 'completed',
            stage: 'librarian',
            title: COPY.modelOutput,
            summary: delta,
          })
      }
      continue
    }

    const tool = toolEntry(chunk, index, toolNames)
    if (tool) {
      appendOrUpdate(entries, tool)
      continue
    }

    const custom = customEntry(chunk, index)
    if (custom) entries.push(custom)
  }
  return entries
}

function traceFingerprint(entry: TraceEntry): string {
  return `${entry.category}:${entry.round ?? 0}:${entry.summary}`
}

function mergeTraceEntries(streamed: TraceEntry[], state: ScientificWorkbenchState): TraceEntry[] {
  const saved = fallbackTrace(state)
  const known = new Set(streamed.map(traceFingerprint))
  return [...streamed, ...saved.filter((entry) => !known.has(traceFingerprint(entry)))]
}
function fallbackTrace(state: ScientificWorkbenchState): TraceEntry[] {
  const entries: TraceEntry[] = []
  if (state.phenomenon) {
    entries.push({
      id: 'saved-input',
      category: 'input',
      status: 'completed',
      stage: 'librarian',
      title: COPY.savedResult,
      summary: state.phenomenon.title,
      details: [{ label: COPY.inputDetails, value: state.phenomenon }],
    })
  }
  for (const hypothesis of state.hypotheses) {
    entries.push({
      id: `saved-hypothesis:${hypothesis.id}`,
      category: 'model',
      status: 'completed',
      stage: 'librarian',
      round: hypothesis.round,
      title: COPY.generatedHypothesis,
      summary: hypothesis.statement,
      details: [{ label: COPY.savedResultDescription, value: COPY.savedResultDescription }],
    })
  }
  for (const evidence of state.evidence) {
    entries.push({
      id: `saved-evidence:${evidence.evidenceId}`,
      category: 'evidence',
      status: 'completed',
      stage: 'explorer',
      round: evidence.round,
      title: COPY.evidenceStatus,
      summary: evidence.claim,
      details: [{ label: COPY.limitations, value: evidence.limitations }],
    })
  }
  for (const correction of state.corrections) {
    entries.push({
      id: `saved-correction:${correction.correctionId ?? entries.length}`,
      category: 'correction',
      status: correction.severity === 'error' ? 'failed' : 'completed',
      stage: stageFrom(correction.stage),
      round: correction.round,
      title: COPY.correction,
      summary: correction.message ?? COPY.savedResultDescription,
    })
  }
  if (state.conclusion) {
    entries.push({
      id: 'saved-summary',
      category: 'result',
      status: 'completed',
      stage: 'oracle',
      round: state.round,
      title: COPY.roundSummary,
      summary: state.conclusion,
    })
  }
  return entries
}

function TraceIcon({ category }: { category: TraceCategory }) {
  const props = { className: 'h-4 w-4' }
  if (category === 'model') return <Sparkles {...props} />
  if (category === 'tool') return <Wrench {...props} />
  if (category === 'processing') return <DatabaseZap {...props} />
  if (category === 'agent') return <Bot {...props} />
  if (category === 'evidence') return <BookOpenCheck {...props} />
  if (category === 'correction') return <ShieldAlert {...props} />
  if (category === 'task') return <ClipboardCheck {...props} />
  if (category === 'route') return <GitBranch {...props} />
  if (category === 'input') return <FileSearch {...props} />
  if (category === 'result') return <Check {...props} />
  return <ListTree {...props} />
}

function TraceEntryCard({
  entry,
  open,
  onToggle,
  isLast,
  detailId,
}: {
  entry: TraceEntry
  open: boolean
  onToggle: () => void
  isLast: boolean
  detailId: string
}) {
  return (
    <article className={`trace-entry trace-entry-${entry.category} trace-entry-${entry.status}`}>
      <div className="trace-entry-rail" aria-hidden="true">
        <span>
          <TraceIcon category={entry.category} />
        </span>
        {!isLast && <i />}
      </div>
      <div className="trace-entry-card">
        <button
          type="button"
          className="trace-entry-button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={onToggle}
        >
          <span className="trace-entry-meta">
            <em>{stageLabel(entry.stage)}</em>
            {entry.round != null && <em>R{entry.round}</em>}
            <em>{categoryLabel(entry.category)}</em>
            <em className={`trace-status trace-status-${entry.status}`}>
              {statusLabel(entry.status)}
            </em>
          </span>
          <strong>{entry.title}</strong>
          <p>{entry.summary}</p>
          <span className="trace-entry-toggle">
            {open ? COPY.hide : COPY.details}
            <ChevronDown className={open ? 'h-3.5 w-3.5 rotate-180' : 'h-3.5 w-3.5'} />
          </span>
        </button>
        {open && (
          <div id={detailId} className="trace-entry-details">
            {entry.details?.length ? (
              entry.details.map((detail, index) => (
                <div key={`${detail.label}-${index}`}>
                  <span>{detail.label}</span>
                  <pre>{formatValue(detail.value)}</pre>
                </div>
              ))
            ) : (
              <div>
                <span>{COPY.details}</span>
                <pre>{COPY.notAvailable}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

export function ScientificTrace({
  chunks,
  state,
  runId,
  streamState,
}: {
  chunks: readonly UIMessageChunk[]
  state: ScientificWorkbenchState
  runId: string | null
  streamState: string
}) {
  const streamedEntries = useMemo(() => buildScientificTrace(chunks), [chunks])
  const entries = useMemo(() => mergeTraceEntries(streamedEntries, state), [streamedEntries, state])
  const [filter, setFilter] = useState<'all' | TraceCategory>('all')
  const [scope, setScope] = useState<'key' | 'full'>('key')
  const [roundFilter, setRoundFilter] = useState<number | 'all'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const rounds = useMemo(
    () =>
      [...new Set(entries.flatMap((entry) => (entry.round == null ? [] : [entry.round])))].sort(
        (a, b) => a - b,
      ),
    [entries],
  )
  const visibleEntries = entries.filter((entry) => {
    if (filter !== 'all' && entry.category !== filter) return false
    if (roundFilter !== 'all' && entry.round !== roundFilter) return false
    if (scope === 'full' || filter !== 'all') return true
    return ['input', 'model', 'processing', 'task', 'route', 'result'].includes(entry.category)
  })
  const groupedEntries = useMemo(() => {
    const groups = new Map<number, TraceEntry[]>()
    for (const entry of visibleEntries) {
      const round = entry.round ?? 0
      groups.set(round, [...(groups.get(round) ?? []), entry])
    }
    return [...groups.entries()].sort(([left], [right]) => left - right)
  }, [visibleEntries])
  const runMetrics = useMemo(() => summarizeScientificTrace(chunks), [chunks])
  const isLive = ['connecting', 'running', 'streaming', 'reconnecting'].includes(streamState)

  return (
    <section className="trace-shell" aria-label={COPY.heading}>
      <header className="trace-header">
        <div>
          <div className="eyebrow-mono text-cyan-200/70">RUN TRACE / AUDITABLE</div>
          <h1>{COPY.heading}</h1>
          <p>{COPY.lead}</p>
        </div>
        <div className="trace-run-stamp">
          <span className={isLive ? 'trace-live-dot trace-live-dot-active' : 'trace-live-dot'} />
          <div>
            <small>{isLive ? COPY.live : COPY.replay}</small>
            <strong>{runId ? runId.slice(-8) : COPY.noRun}</strong>
          </div>
        </div>
      </header>

      <div className="trace-metrics" aria-label="trace metrics">
        <div>
          <span>{COPY.modelCalls}</span>
          <strong>{runMetrics.modelCalls}</strong>
        </div>
        <div>
          <span>{COPY.reasoningTokens}</span>
          <strong>{runMetrics.reasoningTokens.toLocaleString('en-US')}</strong>
        </div>
        <div>
          <span>{COPY.processingRuns}</span>
          <strong>{runMetrics.processingRuns}</strong>
        </div>
        <div>
          <span>{COPY.evidenceAndCorrection}</span>
          <strong>
            {state.evidence.length} / {state.corrections.length}
          </strong>
        </div>
      </div>

      <div className="trace-filter-bar" aria-label="trace controls">
        <div role="tablist" aria-label="事件类型">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={filter === item.id ? 'trace-filter trace-filter-active' : 'trace-filter'}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="trace-view-controls">
          <button
            type="button"
            className={scope === 'key' ? 'trace-filter trace-filter-active' : 'trace-filter'}
            onClick={() => setScope('key')}
          >
            关键节点
          </button>
          <button
            type="button"
            className={scope === 'full' ? 'trace-filter trace-filter-active' : 'trace-filter'}
            onClick={() => setScope('full')}
          >
            完整事件
          </button>
          <select
            value={roundFilter}
            onChange={(event) =>
              setRoundFilter(event.target.value === 'all' ? 'all' : Number(event.target.value))
            }
            aria-label="轨迹轮次"
          >
            <option value="all">全部轮次</option>
            {rounds.map((round) => (
              <option key={round} value={round}>
                第 {round} 轮
              </option>
            ))}
          </select>
          <span>
            {visibleEntries.length} / {entries.length} 条
          </span>
        </div>
      </div>

      <div className="trace-layout">
        <div className="trace-ribbon" aria-hidden="true">
          {TRACE_STAGES.map((stage, index) => (
            <div
              key={stage}
              className={`trace-ribbon-stage trace-ribbon-stage-${stage.toLowerCase()}`}
            >
              <i />
              <span>{index + 1}</span>
              <small>{stageLabel(stage).split(' / ')[1]}</small>
            </div>
          ))}
        </div>

        <div className="trace-list" aria-live="polite">
          {visibleEntries.length === 0 && (
            <div className="trace-empty">
              <CircleDot className="h-5 w-5" />
              <strong>{COPY.noTrace}</strong>
              <p>{COPY.noTraceDescription}</p>
            </div>
          )}
          {groupedEntries.map(([round, roundEntries]) => (
            <section key={round} className="trace-round-group">
              <header>
                <span>{round === 0 ? '运行级事件' : `第 ${round} 轮`}</span>
                <strong>{roundEntries.length} 条</strong>
              </header>
              {roundEntries.map((entry, index) => (
                <TraceEntryCard
                  key={entry.id}
                  entry={entry}
                  open={expanded === entry.id}
                  onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  isLast={index === roundEntries.length - 1}
                  detailId={`trace-detail-${round}-${index}`}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
    </section>
  )
}
