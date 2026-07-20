'use client'

import type { AddCredentialRequest, CredentialResponse } from '@open-scientist/schema'
import { Key, Plus, Trash2 } from 'lucide-react'
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
import { useAddCredential, useCredentials, useDeleteCredential } from '@/lib/hooks/useApi'

const PROVIDER_COLOR: Record<string, string> = {
  openai: '#10b981',
  anthropic: '#8b5cf6',
}

interface FormState {
  id: string
  provider: 'openai' | 'anthropic'
  type: 'api-key' | 'oauth-token'
  key: string
  baseURL: string
  metadataJson: string
}

const EMPTY_FORM: FormState = {
  id: '',
  provider: 'openai',
  type: 'api-key',
  key: '',
  baseURL: '',
  metadataJson: '',
}

function buildAddBody(form: FormState): AddCredentialRequest {
  const body: AddCredentialRequest = {
    provider: form.provider,
    type: form.type,
    key: form.key,
  }
  if (form.id.trim()) body.id = form.id.trim()
  if (form.baseURL.trim()) body.baseURL = form.baseURL.trim()
  if (form.metadataJson.trim()) {
    body.metadata = JSON.parse(form.metadataJson) as Record<string, unknown>
  }
  return body
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="block">{label}</Label>
      {children}
    </div>
  )
}

function CredentialCard({
  cred,
  index,
  onDelete,
  deleting,
}: {
  cred: CredentialResponse
  index: number
  onDelete: () => void
  deleting: boolean
}) {
  const color = PROVIDER_COLOR[cred.provider] ?? '#7d8187'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="group relative overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors hover:border-white/20"
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="font-mono text-[11px] uppercase tracking-[1.4px]" style={{ color }}>
                {cred.provider}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[1.2px] text-muted">
                · {cred.type}
              </span>
            </div>
            <p className="mt-2 truncate font-mono text-sm text-white" title={cred.id}>
              {cred.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Detail rows */}
        <div className="mt-4 space-y-2.5 border-t border-[var(--color-border)] pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[1.2px] text-muted">
              base url
            </span>
            <span className="truncate font-mono text-xs text-body" title={cred.baseURL ?? ''}>
              {cred.baseURL || 'default'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[1.2px] text-muted">
              api key
            </span>
            {cred.hasKey ? (
              <span className="flex items-center gap-1.5 font-mono text-xs text-emerald-400">
                <Key className="h-3 w-3" />
                set
              </span>
            ) : (
              <span className="font-mono text-xs text-red-400">missing</span>
            )}
          </div>
          {cred.metadata && Object.keys(cred.metadata).length > 0 && (
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[1.2px] text-muted">
                metadata
              </span>
              <span className="truncate font-mono text-xs text-body">
                {Object.keys(cred.metadata).join(', ')}
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export function CredentialList() {
  const credsQuery = useCredentials()
  const addMutation = useAddCredential()
  const deleteMutation = useDeleteCredential()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.key) {
      setError('key 必填')
      return
    }
    let body: AddCredentialRequest
    try {
      body = buildAddBody(form)
    } catch (err) {
      setError(`metadata JSON 解析失败：${err instanceof Error ? err.message : String(err)}`)
      return
    }
    try {
      await addMutation.mutateAsync(body)
      setForm(EMPTY_FORM)
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm(`确认删除 credential「${id}」？`)) return
    try {
      await deleteMutation.mutateAsync(id)
    } catch (err) {
      window.alert(`删除失败：${err instanceof ApiError ? err.message : String(err)}`)
    }
  }

  return (
    <section className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-5">
        <div>
          <Eyebrow>Endpoint Bundles</Eyebrow>
          <h3 className="mt-2 text-xl font-normal text-white">Credentials</h3>
          <p className="mt-1 text-sm text-muted">
            一个 credential = 一个完整 endpoint（provider + key + 可选 baseURL）。
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              添加
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>添加 Credential</DialogTitle>
              <DialogDescription>
                一个 credential = 一个完整 endpoint bundle（provider + key + 可选 baseURL）。id
                省略则自动生成。
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-5 pt-2">
              <FieldGroup label="ID（可选）">
                <Input
                  value={form.id}
                  onChange={(e) => setForm({ ...form, id: e.target.value })}
                  placeholder="留空则自动生成 provider-时间戳"
                  className="font-mono text-xs"
                />
              </FieldGroup>

              <div className="grid grid-cols-2 gap-4">
                <FieldGroup label="Provider">
                  <Select
                    value={form.provider}
                    onValueChange={(v: 'openai' | 'anthropic') => setForm({ ...form, provider: v })}
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
                <FieldGroup label="Type">
                  <Select
                    value={form.type}
                    onValueChange={(v: 'api-key' | 'oauth-token') => setForm({ ...form, type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="api-key">api-key</SelectItem>
                      <SelectItem value="oauth-token">oauth-token</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldGroup>
              </div>

              <FieldGroup label="API Key">
                <Input
                  type="password"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  placeholder="sk-..."
                  required
                  className="font-mono text-xs"
                />
              </FieldGroup>

              <FieldGroup label="Base URL（可选）">
                <Input
                  value={form.baseURL}
                  onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="font-mono text-xs"
                />
              </FieldGroup>

              <FieldGroup label="Metadata（JSON，可选）">
                <Textarea
                  value={form.metadataJson}
                  onChange={(e) => setForm({ ...form, metadataJson: e.target.value })}
                  placeholder='{"note": "..."}'
                  className="min-h-[70px] font-mono text-xs"
                />
              </FieldGroup>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    取消
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={addMutation.isPending}>
                  {addMutation.isPending && <Spinner className="mr-1" />}
                  添加
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {/* Body — grid */}
      <div className="p-6">
        {credsQuery.isLoading && (
          <div className="flex items-center justify-center py-16 text-muted">
            <Spinner className="mr-2" /> 加载中…
          </div>
        )}
        {credsQuery.isError && (
          <div className="rounded-sm border border-red-500/30 bg-red-500/[0.04] px-4 py-3 text-sm text-red-400">
            加载失败：
            {credsQuery.error instanceof ApiError
              ? credsQuery.error.message
              : String(credsQuery.error)}
          </div>
        )}
        {credsQuery.data && credsQuery.data.length === 0 && (
          <div className="rounded-sm border border-dashed border-[var(--color-border)] py-16 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[1.4px] text-muted">
              No credentials
            </p>
            <p className="mt-1 text-xs text-muted">添加第一个 credential 以开始</p>
          </div>
        )}
        {credsQuery.data && credsQuery.data.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {credsQuery.data.map((c, i) => (
              <CredentialCard
                key={c.id}
                cred={c}
                index={i}
                onDelete={() => handleDelete(c.id)}
                deleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
