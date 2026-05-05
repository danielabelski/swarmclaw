import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/app/api-client'
import {
  bulkUpdateTasks,
  createTask,
  fetchTasks,
  importGitHubIssues,
  updateTask,
  type GitHubIssueImportRequest,
  type GitHubIssueImportResult,
  type TaskWriteInput,
} from '@/lib/tasks'
import type { BoardTask, BoardTaskStatus, TaskComment } from '@/types'

export type {
  GitHubIssueImportRequest,
  GitHubIssueImportResult,
} from '@/lib/tasks'

type TasksRecord = Record<string, BoardTask>
type QueryOptions = {
  enabled?: boolean
  includeArchived?: boolean
}
type TasksSnapshot = Array<[readonly unknown[], TasksRecord | undefined]>

export const taskQueryKeys = {
  all: ['tasks'] as const,
  lists: () => ['tasks', 'list'] as const,
  list: (params: { includeArchived: boolean }) => ['tasks', 'list', params] as const,
}

function includeArchivedFromKey(key: readonly unknown[]): boolean {
  const params = key[2]
  return typeof params === 'object' && params !== null && (params as { includeArchived?: boolean }).includeArchived === true
}

function captureTaskSnapshots(queryClient: ReturnType<typeof useQueryClient>): TasksSnapshot {
  return queryClient.getQueriesData<TasksRecord>({ queryKey: taskQueryKeys.lists() }) as TasksSnapshot
}

function restoreTaskSnapshots(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: TasksSnapshot | undefined,
): void {
  if (!snapshots) return
  for (const [key, data] of snapshots) {
    queryClient.setQueryData(key, data)
  }
}

function applyTaskListPatch(
  current: TasksRecord | undefined,
  taskId: string,
  nextTask: BoardTask | null,
  includeArchived: boolean,
): TasksRecord | undefined {
  if (!current) return current
  const next = { ...current }
  if (!nextTask || (!includeArchived && nextTask.status === 'archived')) {
    delete next[taskId]
    return next
  }
  next[taskId] = nextTask
  return next
}

function patchTaskCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (current: TasksRecord | undefined, includeArchived: boolean) => TasksRecord | undefined,
): TasksSnapshot {
  const snapshots = captureTaskSnapshots(queryClient)
  for (const [key] of snapshots) {
    queryClient.setQueryData<TasksRecord>(key, (current) => updater(current, includeArchivedFromKey(key)))
  }
  return snapshots
}

export function useTasksQuery(options: QueryOptions = {}) {
  const includeArchived = options.includeArchived ?? false
  return useQuery<TasksRecord>({
    queryKey: taskQueryKeys.list({ includeArchived }),
    queryFn: () => fetchTasks(includeArchived),
    enabled: options.enabled,
    staleTime: 10_000,
  })
}

export function useCreateTaskMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createTask,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKeys.all })
    },
  })
}

export function useUpdateTaskMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskWriteInput }) => updateTask(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: taskQueryKeys.lists() })
      const snapshots = patchTaskCaches(queryClient, (current, includeArchived) => {
        const existing = current?.[id]
        if (!existing) return current
        const nextTask = { ...existing, ...patch, updatedAt: Date.now() }
        return applyTaskListPatch(current, id, nextTask, includeArchived)
      })
      return { snapshots }
    },
    onError: (_error, _variables, context) => {
      restoreTaskSnapshots(queryClient, context?.snapshots)
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKeys.all })
    },
  })
}

export function useBulkUpdateTasksMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: { status?: BoardTaskStatus; agentId?: string; projectId?: string | null } }) =>
      bulkUpdateTasks(ids, patch),
    onMutate: async ({ ids, patch }) => {
      await queryClient.cancelQueries({ queryKey: taskQueryKeys.lists() })
      const snapshots = patchTaskCaches(queryClient, (current, includeArchived) => {
        if (!current) return current
        const next = { ...current }
        for (const id of ids) {
          const existing = next[id]
          if (!existing) continue
          const updated: BoardTask = {
            ...existing,
            ...patch,
            agentId: patch.agentId ?? existing.agentId,
            projectId: patch.projectId === undefined ? existing.projectId : patch.projectId ?? undefined,
            updatedAt: Date.now(),
          }
          if (!includeArchived && updated.status === 'archived') {
            delete next[id]
            continue
          }
          next[id] = updated
        }
        return next
      })
      return { snapshots }
    },
    onError: (_error, _variables, context) => {
      restoreTaskSnapshots(queryClient, context?.snapshots)
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKeys.all })
    },
  })
}

export function useClearDoneTasksMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api('DELETE', '/tasks?filter=done'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKeys.all })
    },
  })
}

export function useImportGitHubIssuesMutation() {
  const queryClient = useQueryClient()
  return useMutation<GitHubIssueImportResult, Error, GitHubIssueImportRequest>({
    mutationFn: importGitHubIssues,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKeys.all })
    },
  })
}

export function useAppendTaskCommentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: TaskComment }) =>
      updateTask(id, { appendComment: comment } as Partial<BoardTask> & { appendComment: TaskComment }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: taskQueryKeys.all })
    },
  })
}
