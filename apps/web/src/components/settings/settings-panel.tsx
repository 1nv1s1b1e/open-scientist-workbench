'use client'

import type { GlobalSettings, ModelConfig } from '@open-scientist/schema'
import { Plus, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError } from '@/lib/api/client'
import { useCredentials, useGlobalSettings, useUpdateGlobalSettings } from '@/lib/hooks/useApi'

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const API_MODES = ['chat', 'responses'] as const
const STEERING_MODES = ['one-at-a-time', 'all'] as const

type Status = { type: 'success' | 'error'; msg: string } | null

function StatusMsg({ status }: { status: Status }) {
  if (!status) return null
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`font-mono text-[11px] uppercase tracking-[1.2px] ${
        status.type === 'success' ? 'text-emerald-400' : 'text-red-400'
      }`}
    >
      {status.msg}
    </motion.span>
  )
}

function SectionShell({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-5">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h3 className="mt-2 text-xl font-normal text-white">{title}</h3>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {action}
      </header>
      <div className="p-6">{children}</div>
    </section>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="block">{label}</Label>
      {children}
    </div>
  )
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  hint: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div className="space-y-2">
      <Label className="block">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="font-mono tabular-nums"
      />
      <p className="font-mono text-[10px] uppercase tracking-[1.2px] text-muted">{hint}</p>
    </div>
  )
}

export function SettingsPanel() {
  const settingsQuery = useGlobalSettings()
  const credsQuery = useCredentials()
  const updateMutation = useUpdateGlobalSettings()
  const data = settingsQuery.data

  const [models, setModels] = useState<Record<string, ModelConfig>>({})
  const [newRole, setNewRole] = useState('')
  const [tournament, setTournament] = useState<GlobalSettings['tournament'] | null>(null)
  const [concurrency, setConcurrency] = useState<GlobalSettings['concurrency'] | null>(null)
  const [steering, setSteering] = useState<GlobalSettings['steering'] | null>(null)
  const [status, setStatus] = useState<Status>(null)

  useEffect(() => {
    if (data) {
      setModels(data.models)
      setTournament(data.tournament)
      setConcurrency(data.concurrency)
      setSteering(data.steering)
    }
  }, [data])

  const save = async (partial: Partial<GlobalSettings>) => {
    if (!data) return
    setStatus(null)
    try {
      const merged: GlobalSettings = {
        models: partial.models ?? data.models,
        agents: partial.agents ?? data.agents,
        tournament: partial.tournament ?? data.tournament,
        concurrency: partial.concurrency ?? data.concurrency,
        steering: partial.steering ?? data.steering,
        modelAliases: partial.modelAliases ?? data.modelAliases,
      }
      await updateMutation.mutateAsync(merged)
      setStatus({ type: 'success', msg: 'saved' })
    } catch (err) {
      setStatus({
        type: 'error',
        msg: err instanceof ApiError ? err.message : String(err),
      })
    }
  }

  const updateModelField = (role: string, field: keyof ModelConfig, value: string) => {
    setModels((prev) => {
      const existing = prev[role]
      if (!existing) return prev
      return { ...prev, [role]: { ...existing, [field]: value } }
    })
  }

  const addRole = () => {
    const role = newRole.trim()
    if (!role || models[role]) return
    setModels((prev) => ({
      ...prev,
      [role]: { model: '', thinkingLevel: 'medium', apiMode: 'chat', credentialId: '' },
    }))
    setNewRole('')
  }

  const removeRole = (role: string) => {
    setModels((prev) => {
      const next = { ...prev }
      delete next[role]
      return next
    })
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] py-16 text-muted">
        <Spinner className="mr-2" /> 加载设置中…
      </div>
    )
  }

  if (settingsQuery.isError || !data) {
    return (
      <div className="rounded-sm border border-red-500/30 bg-red-500/[0.04] px-6 py-4 text-sm text-red-400">
        加载失败：
        {settingsQuery.error instanceof ApiError
          ? settingsQuery.error.message
          : String(settingsQuery.error)}
      </div>
    )
  }

  const aliases = data.modelAliases ?? {}

  return (
    <Tabs defaultValue="models">
      <TabsList>
        <TabsTrigger value="models">模型配置</TabsTrigger>
        <TabsTrigger value="tournament">锦标赛</TabsTrigger>
        <TabsTrigger value="concurrency">并发</TabsTrigger>
        <TabsTrigger value="steering">引导</TabsTrigger>
      </TabsList>

      {/* ── 模型配置 ──────────────────────────────────────────────────────────── */}
      <TabsContent value="models">
        <SectionShell
          eyebrow="Role · ModelConfig"
          title="角色模型映射"
          description="每个 agent 角色绑定一个 ModelConfig，以 credentialId 引用完整 endpoint。"
          action={
            <Button size="sm" onClick={() => save({ models })} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Spinner className="mr-1" />}
              保存
            </Button>
          }
        >
          {/* Role config cards */}
          {Object.keys(models).length === 0 ? (
            <div className="rounded-sm border border-dashed border-[var(--color-border)] py-16 text-center">
              <p className="font-mono text-[11px] uppercase tracking-[1.4px] text-muted">
                No roles configured
              </p>
              <p className="mt-1 text-xs text-muted">添加第一个角色以开始</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(models).map(([role, cfg]) => (
                <motion.div
                  key={role}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group relative rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] p-5 transition-colors hover:border-white/20"
                >
                  {/* Role header */}
                  <div className="mb-4 flex items-center justify-between">
                    <span className="font-mono text-sm uppercase tracking-[1.6px] text-white">
                      {role}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRole(role)}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-muted opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Fields — 2-col grid with breathing room */}
                  <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
                    <FieldGroup label="Model">
                      <Input
                        value={cfg.model}
                        onChange={(e) => updateModelField(role, 'model', e.target.value)}
                        placeholder="llab/Qwen3-Next-80B-A3B-Instruct"
                        className="font-mono text-xs"
                      />
                    </FieldGroup>
                    <FieldGroup label="Credential ID">
                      {credsQuery.data && credsQuery.data.length > 0 ? (
                        <Select
                          value={cfg.credentialId}
                          onValueChange={(v) => updateModelField(role, 'credentialId', v)}
                        >
                          <SelectTrigger className="font-mono text-xs">
                            <SelectValue placeholder="选择 Credential" />
                          </SelectTrigger>
                          <SelectContent>
                            {credsQuery.data.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.id} ({c.provider})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={cfg.credentialId}
                          onChange={(e) => updateModelField(role, 'credentialId', e.target.value)}
                          placeholder="openai-main"
                          className="font-mono text-xs"
                        />
                      )}
                    </FieldGroup>
                    <FieldGroup label="Thinking Level">
                      <Select
                        value={cfg.thinkingLevel}
                        onValueChange={(v) => updateModelField(role, 'thinkingLevel', v)}
                      >
                        <SelectTrigger className="font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {THINKING_LEVELS.map((lv) => (
                            <SelectItem key={lv} value={lv}>
                              {lv}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FieldGroup>
                    <FieldGroup label="API Mode">
                      <Select
                        value={cfg.apiMode}
                        onValueChange={(v) => updateModelField(role, 'apiMode', v)}
                      >
                        <SelectTrigger className="font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {API_MODES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FieldGroup>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Add role — dashed zone */}
          <div className="mt-4 rounded-sm border border-dashed border-[var(--color-border)] p-4">
            <div className="flex items-center gap-3">
              <Input
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                placeholder="输入 role 名，如 sisyphus"
                className="flex-1 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addRole()
                  }
                }}
              />
              <Button size="sm" variant="outline" onClick={addRole} disabled={!newRole.trim()}>
                <Plus className="h-3.5 w-3.5" />
                新增
              </Button>
            </div>
          </div>

          {/* Model aliases — read-only */}
          <div className="mt-8 border-t border-[var(--color-border)] pt-6">
            <Eyebrow>Model Aliases · read-only</Eyebrow>
            {Object.keys(aliases).length === 0 ? (
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[1.4px] text-muted">
                None
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                {Object.entries(aliases).map(([alias, cfg]) => (
                  <div
                    key={alias}
                    className="flex items-center gap-3 rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3"
                  >
                    <span className="font-mono text-xs uppercase tracking-[1.2px] text-white">
                      {alias}
                    </span>
                    <span className="truncate font-mono text-xs text-muted">{cfg.model}</span>
                    <span className="ml-auto rounded-full border border-[var(--color-border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[1px] text-muted">
                      {cfg.thinkingLevel}
                    </span>
                    <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[1px] text-muted">
                      {cfg.apiMode}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4">
            <StatusMsg status={status} />
          </div>
        </SectionShell>
      </TabsContent>

      {/* ── 锦标赛 ────────────────────────────────────────────────────────────── */}
      <TabsContent value="tournament">
        <SectionShell
          eyebrow="Tournament · Evolution Loop"
          title="锦标赛演化参数"
          description="控制闭环协调智能体编排的假设演化循环。"
          action={
            <Button
              size="sm"
              onClick={() => tournament && save({ tournament })}
              disabled={updateMutation.isPending || !tournament}
            >
              {updateMutation.isPending && <Spinner className="mr-1" />}
              保存
            </Button>
          }
        >
          {tournament && (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <NumberField
                label="maxRounds"
                hint="最大轮次"
                value={tournament.maxRounds}
                onChange={(v) => setTournament({ ...tournament, maxRounds: v })}
                min={1}
              />
              <NumberField
                label="targetF1"
                hint="目标 F1 (0–1)"
                value={tournament.targetF1}
                onChange={(v) => setTournament({ ...tournament, targetF1: v })}
                min={0}
                max={1}
                step={0.01}
              />
              <NumberField
                label="convergenceWindow"
                hint="收敛窗口"
                value={tournament.convergenceWindow}
                onChange={(v) => setTournament({ ...tournament, convergenceWindow: v })}
                min={1}
              />
              <NumberField
                label="convergenceThreshold"
                hint="收敛阈值"
                value={tournament.convergenceThreshold}
                onChange={(v) => setTournament({ ...tournament, convergenceThreshold: v })}
                min={0}
                step={0.001}
              />
            </div>
          )}
          <div className="mt-4">
            <StatusMsg status={status} />
          </div>
        </SectionShell>
      </TabsContent>

      {/* ── 并发 ──────────────────────────────────────────────────────────────── */}
      <TabsContent value="concurrency">
        <SectionShell
          eyebrow="Concurrency"
          title="并发限制"
          description="同时运行的最大 tournament 数量。"
          action={
            <Button
              size="sm"
              onClick={() => concurrency && save({ concurrency })}
              disabled={updateMutation.isPending || !concurrency}
            >
              {updateMutation.isPending && <Spinner className="mr-1" />}
              保存
            </Button>
          }
        >
          {concurrency && (
            <div className="max-w-xs">
              <NumberField
                label="maxConcurrentRuns"
                hint="最大并发 run 数"
                value={concurrency.maxConcurrentRuns}
                onChange={(v) => setConcurrency({ ...concurrency, maxConcurrentRuns: v })}
                min={1}
              />
            </div>
          )}
          <div className="mt-4">
            <StatusMsg status={status} />
          </div>
        </SectionShell>
      </TabsContent>

      {/* ── 引导 ──────────────────────────────────────────────────────────────── */}
      <TabsContent value="steering">
        <SectionShell
          eyebrow="Steering · Human-in-the-loop"
          title="引导模式"
          description="控制人工插话（steering）的传递方式。"
          action={
            <Button
              size="sm"
              onClick={() => steering && save({ steering })}
              disabled={updateMutation.isPending || !steering}
            >
              {updateMutation.isPending && <Spinner className="mr-1" />}
              保存
            </Button>
          }
        >
          {steering && (
            <div className="max-w-sm space-y-3">
              <FieldGroup label="mode">
                <Select
                  value={steering.mode}
                  onValueChange={(v: (typeof STEERING_MODES)[number]) =>
                    setSteering({ ...steering, mode: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STEERING_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldGroup>
              <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[1.2px] text-muted">
                one-at-a-time — 仅传给当前活跃 agent · all — 广播给全部
              </p>
            </div>
          )}
          <div className="mt-4">
            <StatusMsg status={status} />
          </div>
        </SectionShell>
      </TabsContent>
    </Tabs>
  )
}
