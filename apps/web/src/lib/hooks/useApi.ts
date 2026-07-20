'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type AddCredentialRequest, api } from '@/lib/api/client'

/** 项目列表 */
export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api.listProjects(),
  })
}

export function useProject(name: string | null) {
  return useQuery({
    queryKey: ['project', name],
    queryFn: () => api.getProject(name!),
    enabled: !!name,
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: import('@open-scientist/schema').CreateProjectRequest) =>
      api.createProject(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.deleteProject(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

/** Settings */
export function useGlobalSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.getGlobalSettings() })
}

export function useUpdateGlobalSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: import('@open-scientist/schema').GlobalSettings) =>
      api.putGlobalSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

export function useProjectSettings(project: string | null) {
  return useQuery({
    queryKey: ['project-settings', project],
    queryFn: () => api.getProjectSettings(project!),
    enabled: !!project,
  })
}

/** Credentials */
export function useCredentials() {
  return useQuery({ queryKey: ['credentials'], queryFn: () => api.listCredentials() })
}

export function useAddCredential() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AddCredentialRequest) => api.addCredential(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  })
}

export function useDeleteCredential() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteCredential(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  })
}

/** Test LLM */
export function useTestLlm() {
  return useMutation({
    mutationFn: (body: import('@open-scientist/schema').TestLlmRequest) => api.testLlm(body),
  })
}

/** Run 状态查询（轮询） */
export function useRunStatus(project: string | null, runId: string | null) {
  return useQuery({
    queryKey: ['run-status', project, runId],
    queryFn: () => api.getRunStatus(project!, runId!),
    enabled: !!project && !!runId,
    // run 进行中时轮询
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'running' || status === 'pending' || status === 'awaiting_approval') {
        return 3000
      }
      return false
    },
  })
}

/** Model aliases */
export function useModelAliases() {
  return useQuery({ queryKey: ['model-aliases'], queryFn: () => api.listModelAliases() })
}
