import { genId } from '@/lib/id'
import type { Schedule, ScheduleHistoryAction, ScheduleHistoryChange, ScheduleHistoryEntry } from '@/types'

export const SCHEDULE_HISTORY_LIMIT = 25

export type ScheduleHistoryActor = {
  actor: string
  actorId?: string | null
}

type ScheduleHistoryOptions = ScheduleHistoryActor & {
  now: number
  createId?: () => string
}

type ScheduleHistoryEventOptions = ScheduleHistoryOptions & {
  action: ScheduleHistoryAction
  summary: string
  changes?: ScheduleHistoryChange[]
  metadata?: Record<string, string | number | boolean | null>
}

const CHANGE_FIELDS: Array<{
  field: keyof Schedule
  label: string
}> = [
  { field: 'name', label: 'Name' },
  { field: 'status', label: 'Status' },
  { field: 'agentId', label: 'Agent' },
  { field: 'projectId', label: 'Project' },
  { field: 'taskMode', label: 'Mode' },
  { field: 'taskPrompt', label: 'Prompt' },
  { field: 'message', label: 'Wake message' },
  { field: 'protocolTemplateId', label: 'Protocol template' },
  { field: 'scheduleType', label: 'Cadence type' },
  { field: 'cron', label: 'Cron' },
  { field: 'intervalMs', label: 'Interval' },
  { field: 'runAt', label: 'Run at' },
  { field: 'timezone', label: 'Timezone' },
  { field: 'staggerSec', label: 'Stagger' },
  { field: 'action', label: 'Action' },
  { field: 'path', label: 'Path' },
  { field: 'command', label: 'Command' },
  { field: 'description', label: 'Description' },
  { field: 'frequency', label: 'Frequency' },
  { field: 'followupConnectorId', label: 'Connector' },
  { field: 'followupChannelId', label: 'Channel' },
  { field: 'followupThreadId', label: 'Thread' },
  { field: 'followupSenderName', label: 'Sender' },
]

const HISTORY_ACTIONS = new Set<ScheduleHistoryAction>([
  'created',
  'updated',
  'archived',
  'restored',
  'run_started',
  'skipped',
  'failed',
  'repaired',
])

function cleanActor(value: string): string {
  const actor = value.trim()
  return actor || 'system'
}

function createHistoryId(options: ScheduleHistoryOptions): string {
  return options.createId ? options.createId() : genId()
}

function normalizeHistoryEntry(value: unknown): ScheduleHistoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entry = value as Partial<ScheduleHistoryEntry>
  if (typeof entry.id !== 'string' || !entry.id.trim()) return null
  if (typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return null
  if (typeof entry.action !== 'string' || !HISTORY_ACTIONS.has(entry.action as ScheduleHistoryAction)) return null
  if (typeof entry.summary !== 'string' || !entry.summary.trim()) return null
  const actor = typeof entry.actor === 'string' && entry.actor.trim() ? entry.actor.trim() : 'system'
  const revision = typeof entry.revision === 'number' && Number.isFinite(entry.revision)
    ? Math.max(1, Math.trunc(entry.revision))
    : 1
  const changes = Array.isArray(entry.changes)
    ? entry.changes
        .map((change) => {
          if (!change || typeof change !== 'object' || Array.isArray(change)) return null
          const candidate = change as Partial<ScheduleHistoryChange>
          if (typeof candidate.field !== 'string' || !candidate.field.trim()) return null
          if (typeof candidate.label !== 'string' || !candidate.label.trim()) return null
          return {
            field: candidate.field.trim(),
            label: candidate.label.trim(),
            before: candidate.before == null ? null : String(candidate.before),
            after: candidate.after == null ? null : String(candidate.after),
          }
        })
        .filter((change): change is ScheduleHistoryChange => Boolean(change))
    : undefined
  const metadata = entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
    ? Object.fromEntries(
        Object.entries(entry.metadata).filter(([, metadataValue]) =>
          metadataValue == null
          || typeof metadataValue === 'string'
          || typeof metadataValue === 'number'
          || typeof metadataValue === 'boolean',
        ),
      )
    : undefined

  return {
    id: entry.id.trim(),
    at: Math.trunc(entry.at),
    actor,
    actorId: typeof entry.actorId === 'string' && entry.actorId.trim() ? entry.actorId.trim() : null,
    action: entry.action as ScheduleHistoryAction,
    revision,
    summary: entry.summary.trim(),
    ...(changes && changes.length > 0 ? { changes } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

export function normalizeScheduleHistory(value: unknown): ScheduleHistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeHistoryEntry)
    .filter((entry): entry is ScheduleHistoryEntry => Boolean(entry))
    .sort((left, right) => right.at - left.at || right.revision - left.revision)
    .slice(0, SCHEDULE_HISTORY_LIMIT)
}

function normalizeRevision(value: unknown, history: ScheduleHistoryEntry[]): number {
  const explicit = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
  const fromHistory = history.reduce((max, entry) => Math.max(max, entry.revision), 0)
  return Math.max(explicit, fromHistory, 0)
}

function compactString(value: string, maxLength = 240): string {
  const compacted = value.replace(/\s+/g, ' ').trim()
  if (compacted.length <= maxLength) return compacted
  return `${compacted.slice(0, maxLength - 1)}...`
}

function formatHistoryValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return compactString(value) || null
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.trunc(value)) : null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    const values = value
      .map((entry) => formatHistoryValue(entry))
      .filter((entry): entry is string => Boolean(entry))
    return values.length > 0 ? compactString(values.join(', ')) : null
  }
  if (typeof value === 'object') return compactString(JSON.stringify(value))
  return null
}

export function diffScheduleHistoryChanges(previous: Schedule, next: Schedule): ScheduleHistoryChange[] {
  const changes: ScheduleHistoryChange[] = []
  for (const item of CHANGE_FIELDS) {
    const before = formatHistoryValue(previous[item.field])
    const after = formatHistoryValue(next[item.field])
    if (before === after) continue
    changes.push({
      field: String(item.field),
      label: item.label,
      before,
      after,
    })
  }
  return changes
}

export function appendScheduleHistoryEntry(
  schedule: Schedule,
  options: ScheduleHistoryEventOptions,
): Schedule {
  const history = normalizeScheduleHistory(schedule.history)
  const revision = normalizeRevision(schedule.revision, history) + 1
  const entry: ScheduleHistoryEntry = {
    id: createHistoryId(options),
    at: Math.trunc(options.now),
    actor: cleanActor(options.actor),
    actorId: options.actorId || null,
    action: options.action,
    revision,
    summary: compactString(options.summary),
    ...(options.changes && options.changes.length > 0 ? { changes: options.changes } : {}),
    ...(options.metadata && Object.keys(options.metadata).length > 0 ? { metadata: options.metadata } : {}),
  }
  const nextHistory = [entry, ...history].slice(0, SCHEDULE_HISTORY_LIMIT)
  return {
    ...schedule,
    revision,
    history: nextHistory,
  }
}

export function applyScheduleCreationHistory(
  schedule: Schedule,
  options: ScheduleHistoryOptions,
): Schedule {
  if (normalizeScheduleHistory(schedule.history).length > 0 || (schedule.revision || 0) > 0) return schedule
  return appendScheduleHistoryEntry(schedule, {
    ...options,
    action: 'created',
    summary: `Schedule created: "${schedule.name}"`,
  })
}

export function applyScheduleUpdateHistory(
  previous: Schedule,
  next: Schedule,
  options: ScheduleHistoryOptions & { summary?: string },
): Schedule {
  const changes = diffScheduleHistoryChanges(previous, next)
  if (changes.length === 0) {
    return {
      ...next,
      revision: normalizeRevision(next.revision ?? previous.revision, normalizeScheduleHistory(next.history ?? previous.history)),
      history: normalizeScheduleHistory(next.history ?? previous.history),
    }
  }
  return appendScheduleHistoryEntry({
    ...next,
    revision: previous.revision,
    history: next.history ?? previous.history,
  }, {
    ...options,
    action: 'updated',
    summary: options.summary || `Schedule updated: "${next.name}"`,
    changes,
  })
}
