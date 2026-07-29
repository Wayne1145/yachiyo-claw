import type { CodingArtifact, CodingBuildRun, CodingChangeSet, CodingProjectRecord } from '@shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { codingProjectStorage } from '@/storage/CodingProjectStorage'
import { reconcileCodingBuildRuns } from '@/mobile/coding-builds'

export const CODING_PROJECTS_KEY = ['coding-projects'] as const
const projectKey = (id: string) => ['coding-project', id] as const
const changesKey = (id: string) => ['coding-changes', id] as const
const buildsKey = (id: string) => ['coding-builds', id] as const
const artifactsKey = (id: string) => ['coding-artifacts', id] as const

export function useCodingProjects() {
  return useQuery({ queryKey: CODING_PROJECTS_KEY, queryFn: () => codingProjectStorage.list<CodingProjectRecord>('projects') })
}

export function useCodingProject(id: string) {
  return useQuery({ queryKey: projectKey(id), queryFn: () => codingProjectStorage.get<CodingProjectRecord>('projects', id), enabled: Boolean(id) })
}

export function useCodingChangeSets(projectId: string) {
  return useQuery({ queryKey: changesKey(projectId), queryFn: () => codingProjectStorage.list<CodingChangeSet>('changesets', projectId), enabled: Boolean(projectId) })
}

export function useCodingBuildRuns(projectId: string) {
  return useQuery({
    queryKey: buildsKey(projectId),
    queryFn: async () => {
      const project = await codingProjectStorage.get<CodingProjectRecord>('projects', projectId)
      return project ? reconcileCodingBuildRuns(project) : []
    },
    enabled: Boolean(projectId),
    refetchInterval: 2_000,
  })
}

export function useCodingArtifacts(projectId: string) {
  return useQuery({ queryKey: artifactsKey(projectId), queryFn: () => codingProjectStorage.list<CodingArtifact>('artifacts', projectId), enabled: Boolean(projectId) })
}

export function useCodingProjectActions() {
  const client = useQueryClient()
  return {
    putProject: async (record: CodingProjectRecord) => {
      await codingProjectStorage.put('projects', record)
      client.setQueryData(projectKey(record.id), record)
      await client.invalidateQueries({ queryKey: CODING_PROJECTS_KEY })
      return record
    },
    putChangeSet: async (record: CodingChangeSet) => {
      await codingProjectStorage.put('changesets', record)
      await client.invalidateQueries({ queryKey: changesKey(record.projectId) })
      return record
    },
    putBuildRun: async (record: CodingBuildRun) => {
      await codingProjectStorage.put('builds', record)
      await client.invalidateQueries({ queryKey: buildsKey(record.projectId) })
      return record
    },
    putArtifact: async (record: CodingArtifact) => {
      await codingProjectStorage.put('artifacts', record)
      await client.invalidateQueries({ queryKey: artifactsKey(record.projectId) })
      return record
    },
  }
}
