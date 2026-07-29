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
