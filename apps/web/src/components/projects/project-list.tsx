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
  index,
  onOpen,
  onDelete,
  deleting,
}: {
  name: string
  index: number
  onOpen: () => void
  onDelete: () => void
  deleting: boolean
}) {
  // Deterministic accent color per project name (hash → hue)
  const hues = [
    { bar: '#3b82f6', glow: 'rgba(59,130,246,0.08)' },
    { bar: '#10b981', glow: 'rgba(16,185,129,0.08)' },
    { bar: '#06b6d4', glow: 'rgba(6,182,212,0.08)' },
    { bar: '#8b5cf6', glow: 'rgba(139,92,246,0.08)' },
    { bar: '#ef4444', glow: 'rgba(239,68,68,0.08)' },
    { bar: '#f59e0b', glow: 'rgba(245,158,11,0.08)' },
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  const accent = hues[Math.abs(hash) % hues.length]!

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: 'easeOut' }}
      whileHover={{ y: -2 }}
      className="group relative overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors hover:border-white/25"
    >
      {/* Hover glow */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: `radial-gradient(ellipse at top, ${accent.glow}, transparent 70%)` }}
      />

      <div className="relative p-6">
        {/* Top — index + delete */}
        <div className="flex items-start justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[1.4px] text-muted">
            {String(index + 1).padStart(2, '0')} / project
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
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[1.2px] text-muted">
            click to enter workspace
          </p>
        </button>

        {/* Bottom — enter pill */}
        <div className="mt-6 flex items-center justify-between border-t border-[var(--color-border)] pt-4">
          <span className="font-mono text-[10px] uppercase tracking-[1.2px] text-muted">
            Workspace
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="group/btn flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[1.2px] text-muted transition-colors hover:text-white"
          >
            Enter
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
          <Eyebrow>Projects · Tournament Workspaces</Eyebrow>
          <h3 className="mt-2 text-xl font-normal text-white">项目工作区</h3>
          <p className="mt-1 text-sm text-muted">每个项目独立存储 run、假设、证据与 MHD 产物。</p>
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
                创建一个新的 tournament 项目工作目录，后续所有 run 与产物均隔离于此。
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

              <FieldGroup label="MCP 配置（JSON，可选）">
                <Textarea
                  value={form.mcpJson}
                  onChange={(e) => setForm({ ...form, mcpJson: e.target.value })}
                  placeholder='{"server-name": {"command": "..."}}'
                  className="min-h-[90px] font-mono text-xs"
                />
              </FieldGroup>

              <FieldGroup label="Skills 目录（逗号分隔，可选）">
                <Input
                  value={form.skillsDirs}
                  onChange={(e) => setForm({ ...form, skillsDirs: e.target.value })}
                  placeholder="path/to/skills, another/path"
                  className="font-mono text-xs"
                />
              </FieldGroup>

              <FieldGroup label="Prompts 目录（可选）">
                <Input
                  value={form.promptsDir}
                  onChange={(e) => setForm({ ...form, promptsDir: e.target.value })}
                  placeholder="path/to/prompts"
                  className="font-mono text-xs"
                />
              </FieldGroup>

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
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[1.4px] text-muted">
              No projects yet
            </p>
            <p className="mt-1.5 text-xs text-muted">点击右上角「新建项目」开始</p>
          </div>
        )}
        {projectsQuery.data && projectsQuery.data.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projectsQuery.data.map((p, i) => (
              <ProjectCard
                key={p.name}
                name={p.name}
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
