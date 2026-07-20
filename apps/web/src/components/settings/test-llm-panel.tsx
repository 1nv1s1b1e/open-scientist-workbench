'use client'

import type { TestLlmRequest, TestLlmResponse } from '@open-scientist/schema'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Eyebrow } from '@/components/site'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api/client'
import { useTestLlm } from '@/lib/hooks/useApi'

const DEFAULT_FORM: Omit<TestLlmRequest, 'apiKey'> = {
  provider: 'openai',
  model: '',
  prompt: 'Say hi in 3 words.',
  maxTokens: 50,
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="block">{label}</Label>
      {children}
    </div>
  )
}

function UsageStat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-5 py-4">
      <p className="font-mono text-[10px] uppercase tracking-[1.2px] text-muted">{label}</p>
      <p className="mt-1.5 font-mono text-2xl tabular-nums text-white">{value ?? '—'}</p>
    </div>
  )
}

export function TestLlmPanel() {
  const testMutation = useTestLlm()
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai')
  const [model, setModel] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState(DEFAULT_FORM.prompt)
  const [maxTokens, setMaxTokens] = useState(DEFAULT_FORM.maxTokens)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TestLlmResponse | null>(null)

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)
    if (!model.trim() || !apiKey.trim()) {
      setError('model 和 apiKey 必填')
      return
    }
    const body: TestLlmRequest = {
      provider,
      model: model.trim(),
      apiKey,
      prompt,
      maxTokens: Number(maxTokens),
    }
    if (baseURL.trim()) body.baseURL = baseURL.trim()
    try {
      const res = await testMutation.mutateAsync(body)
      setResult(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  return (
    <section className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Header */}
      <header className="border-b border-[var(--color-border)] px-6 py-5">
        <Eyebrow>Connectivity · thinkingLevel off</Eyebrow>
        <h3 className="mt-2 text-xl font-normal text-white">LLM 连通性测试</h3>
        <p className="mt-1 text-sm text-muted">
          直接调用 generateText 验证 endpoint 可达。thinkingLevel 硬编码为 off。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-px bg-[var(--color-border)] lg:grid-cols-2">
        {/* ── Left — form ──────────────────────────────────────────────────────── */}
        <form onSubmit={handleTest} className="space-y-5 bg-[var(--color-surface)] p-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FieldGroup label="Provider">
              <Select
                value={provider}
                onValueChange={(v: 'openai' | 'anthropic') => setProvider(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">openai</SelectItem>
                  <SelectItem value="anthropic">anthropic</SelectItem>
                </SelectContent>
              </Select>
            </FieldGroup>
            <FieldGroup label="Model">
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o / claude-3-5-sonnet"
                required
                className="font-mono text-xs"
              />
            </FieldGroup>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FieldGroup label="Base URL（可选）">
              <Input
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="font-mono text-xs"
              />
            </FieldGroup>
            <FieldGroup label="maxTokens">
              <Input
                type="number"
                min={1}
                max={4096}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="font-mono tabular-nums"
              />
            </FieldGroup>
          </div>

          <FieldGroup label="API Key">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              required
              className="font-mono text-xs"
            />
          </FieldGroup>

          <FieldGroup label="Prompt">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[90px] font-mono text-xs"
            />
          </FieldGroup>

          <div className="flex items-center gap-4 pt-2">
            <Button type="submit" disabled={testMutation.isPending}>
              {testMutation.isPending && <Spinner className="mr-1" />}
              测试连接
            </Button>
            {error && (
              <span className="font-mono text-[11px] uppercase tracking-[1.2px] text-red-400">
                {error}
              </span>
            )}
          </div>
        </form>

        {/* ── Right — result panel ────────────────────────────────────────────── */}
        <div className="bg-[var(--color-bg)] p-6">
          {!result && !testMutation.isPending && (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center text-center">
              <div className="relative flex h-20 w-20 items-center justify-center">
                <span className="absolute inset-0 rounded-full border border-[var(--color-border)]" />
                <span className="absolute inset-3 rounded-full border border-white/[0.06]" />
                <span className="absolute inset-6 rounded-full border border-white/[0.04]" />
                <span className="h-2 w-2 rounded-full bg-[var(--color-border-strong)]" />
              </div>
              <p className="mt-5 font-mono text-[11px] uppercase tracking-[1.4px] text-muted">
                Awaiting test
              </p>
              <p className="mt-1.5 text-xs text-muted">提交表单以查看响应</p>
            </div>
          )}

          {testMutation.isPending && (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center">
              <Spinner className="mb-4" />
              <p className="font-mono text-[11px] uppercase tracking-[1.4px] text-muted">
                Calling model…
              </p>
            </div>
          )}

          {result && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Status banner */}
              <div
                className={`flex items-center gap-4 rounded-sm border px-5 py-4 ${
                  result.ok
                    ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
                    : 'border-red-500/30 bg-red-500/[0.06]'
                }`}
              >
                {result.ok ? (
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="h-6 w-6 shrink-0 text-red-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={`font-mono text-[12px] uppercase tracking-[1.4px] ${
                      result.ok ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {result.ok ? 'Success' : 'Failed'}
                  </p>
                  {result.model && (
                    <p className="mt-0.5 truncate font-mono text-xs text-body">{result.model}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums text-muted">
                  <Clock className="h-3 w-3" />
                  {result.durationMs}ms
                </div>
              </div>

              {/* Response text */}
              {result.ok && result.text && (
                <div>
                  <Eyebrow>Response</Eyebrow>
                  <pre className="mt-2 max-h-56 overflow-auto rounded-sm border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-body">
                    {result.text}
                  </pre>
                </div>
              )}

              {/* Error detail */}
              {!result.ok && result.error && (
                <div>
                  <Eyebrow>Error</Eyebrow>
                  <pre className="mt-2 max-h-56 overflow-auto rounded-sm border border-red-500/30 bg-red-500/[0.04] p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-red-300">
                    {result.error}
                  </pre>
                </div>
              )}

              {/* Usage metrics */}
              {result.usage && (
                <div>
                  <Eyebrow>Usage · tokens</Eyebrow>
                  <div className="mt-2 grid grid-cols-3 gap-3">
                    <UsageStat label="prompt" value={result.usage.promptTokens} />
                    <UsageStat label="completion" value={result.usage.completionTokens} />
                    <UsageStat label="total" value={result.usage.totalTokens} />
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </section>
  )
}
