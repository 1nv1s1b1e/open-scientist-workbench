'use client'

import type { CreateProjectRequest } from '@open-scientist/schema'
import { ArrowRight, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Eyebrow } from '@/components/site'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api/client'
import { useCreateProject, useDeleteProject, useProjects } from '@/lib/hooks/useApi'

interface ProjectListProps {
  onOpen: (name: string) => void
}

interface FormState {
  name: string
  mcpJson: string
  skillsDirs: string
  promptsDir: string
}

const EMPTY_FORM: FormState = {
  name: '',
  mcpJson: '',
  skillsDirs: '',
  promptsDir: '',
}

const PROJECT_SUMMARY_FALLBACKS: Record<string, string> = {
  'coronal-heating-demo': '活动区出现不同步的多波段升温',
}

function compactProjectSummary(summary: string | null, name: string) {
  const value = summary?.trim() || PROJECT_SUMMARY_FALLBACKS[name] || '尚未登记输入现象'
  const normalized = value.replace(/\s+/g, ' ')
  const firstSentence = normalized.match(/^.*?[。！？!?]/)?.[0] ?? normalized
  return firstSentence.length > 25 ? `${firstSentence.slice(0, 25).trimEnd()}…` : firstSentence
}

function buildCreateBody(form: FormState): CreateProjectRequest {
  const config: CreateProjectRequest['config'] = {}
  if (form.mcpJson.trim()) {
    config.mcp = JSON.parse(form.mcpJson) as Record<string, unknown>
  }
  const dirs = form.skillsDirs
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (dirs.length > 0) config.skills = dirs
  if (form.promptsDir.trim()) config.prompts = form.promptsDir.trim()
  return { name: form.name.trim(), ...(Object.keys(config).length > 0 ? { config } : {}) }
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="block">{label}</Label>
      {children}
    </div>
  )
}

function ProjectCard({
  name,
  summary,
  index,
  onOpen,
  onDelete,
  deleting,
}: {
  name: string
  summary: string | null
  index: number
  onOpen: () => void
  onDelete: () => void
  deleting: boolean
}) {
  // 统一项目固定色：暖橙（与主题一致），不再按名字哈希出多种红蓝绿。
  const accent = { bar: '#ffc285', glow: 'rgba(255,194,133,0.08)' }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: 'easeOut' }}
      whileHover={{ y: -2 }}
      className="project-card group relative overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors hover:border-white/25"
    >
      {/* Hover glow */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: `radial-gradient(ellipse at top, ${accent.glow}, transparent 70%)` }}
      />

      <div className="relative p-6">
        {/* Top — index + delete */}
        <div className="flex items-start justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[1.4px] text-muted">
            项目 {String(index + 1).padStart(2, '0')}
          </span>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Middle — folder icon + name */}
        <button type="button" onClick={onOpen} className="mt-5 block w-full text-left">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-sm border transition-colors group-hover:border-white/30"
            style={{ backgroundColor: accent.glow, borderColor: 'var(--color-border)' }}
          >
            <FolderOpen className="h-4 w-4" style={{ color: accent.bar }} />
          </div>
          <h3 className="mt-4 truncate font-mono text-lg font-normal tracking-tight text-white">
            {name}
          </h3>
          <p className="project-card-summary">{compactProjectSummary(summary, name)}</p>
        </button>

        {/* Bottom — enter pill */}
        <div className="mt-6 flex items-center justify-between border-t border-[var(--color-border)] pt-4">
          <span className="font-mono text-[11px] uppercase tracking-[1.2px] text-muted">
            独立记录
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="group/btn flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[1.2px] text-muted transition-colors hover:text-white"
          >
            打开
            <ArrowRight className="h-3 w-3 transition-transform group-hover/btn:translate-x-0.5" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

export function ProjectList({ onOpen }: ProjectListProps) {
  const projectsQuery = useProjects()
  const createMutation = useCreateProject()
  const deleteMutation = useDeleteProject()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) {
      setError('项目名称必填')
      return
    }
    let body: CreateProjectRequest
    try {
      body = buildCreateBody(form)
    } catch (err) {
      setError(`MCP JSON 解析失败：${err instanceof Error ? err.message : String(err)}`)
      return
    }
    try {
      await createMutation.mutateAsync(body)
      setForm(EMPTY_FORM)
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  const handleDelete = async (name: string) => {
    if (!window.confirm(`确认删除项目「${name}」？该操作不可撤销。`)) return
    try {
      await deleteMutation.mutateAsync(name)
    } catch (err) {
      window.alert(`删除失败：${err instanceof ApiError ? err.message : String(err)}`)
    }
  }

  return (
    <section className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-5">
        <div>
          <Eyebrow>PROJECTS</Eyebrow>
          <h3 className="mt-2 text-xl font-normal text-white">选择一个项目</h3>
          <p className="mt-1 text-sm text-muted">每个项目独立保存现象、分析记录与下一步任务。</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              新建项目
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>新建项目</DialogTitle>
              <DialogDescription>
                创建一个独立项目，用于保存后续的现象、分析记录和验证任务。
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-5 pt-2">
              <FieldGroup label="项目名称">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="alfven-heating"
                  required
                  className="font-mono text-sm"
                />
              </FieldGroup>

              <details className="project-advanced-options">
                <summary>高级配置（可选）</summary>
                <p>只有需要接入额外工具或自定义提示词时才需要填写；普通分析项目可直接创建。</p>
                <div className="mt-4 space-y-4">
                  <FieldGroup label="工具连接配置（JSON，可选）">
                    <Textarea
                      value={form.mcpJson}
                      onChange={(e) => setForm({ ...form, mcpJson: e.target.value })}
                      placeholder='{"server-name": {"command": "..."}}'
                      className="min-h-[90px] font-mono text-xs"
                    />
                  </FieldGroup>

                  <FieldGroup label="技能目录（逗号分隔，可选）">
                    <Input
                      value={form.skillsDirs}
                      onChange={(e) => setForm({ ...form, skillsDirs: e.target.value })}
                      placeholder="path/to/skills, another/path"
                      className="font-mono text-xs"
                    />
                  </FieldGroup>

                  <FieldGroup label="提示词目录（可选）">
                    <Input
                      value={form.promptsDir}
                      onChange={(e) => setForm({ ...form, promptsDir: e.target.value })}
                      placeholder="path/to/prompts"
                      className="font-mono text-xs"
                    />
                  </FieldGroup>
                </div>
              </details>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    取消
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending && <Spinner className="mr-1" />}
                  创建
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {/* Body — grid */}
      <div className="p-6">
        {projectsQuery.isLoading && (
          <div className="flex items-center justify-center py-16 text-muted">
            <Spinner className="mr-2" /> 加载中…
          </div>
        )}
        {projectsQuery.isError && (
          <div className="rounded-sm border border-red-500/30 bg-red-500/[0.04] px-4 py-3 text-sm text-red-400">
            加载失败：
            {projectsQuery.error instanceof ApiError
              ? projectsQuery.error.message
              : String(projectsQuery.error)}
          </div>
        )}
        {projectsQuery.data && projectsQuery.data.length === 0 && (
          <div className="rounded-sm border border-dashed border-[var(--color-border)] py-20 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)]">
              <FolderOpen className="h-5 w-5 text-muted" />
            </div>
            <p className="mt-4 font-mono text-[12px] uppercase tracking-[1.4px] text-muted">
              还没有项目
            </p>
            <p className="mt-1.5 text-xs text-muted">点击右上角「新建项目」开始</p>
          </div>
        )}
        {projectsQuery.data && projectsQuery.data.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {projectsQuery.data.map((p, i) => (
              <ProjectCard
                key={p.name}
                name={p.name}
                summary={p.summary}
                index={i}
                onOpen={() => onOpen(p.name)}
                onDelete={() => handleDelete(p.name)}
                deleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
