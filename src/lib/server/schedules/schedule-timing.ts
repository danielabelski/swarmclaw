import { createHash } from 'node:crypto'

import { CronExpressionParser } from 'cron-parser'

import type { ScheduleType } from '@/types'

export type ScheduleTimingRepairReason = 'missing' | 'invalid' | 'stale_future'

export type ScheduleTimingInput = {
  id?: string | null
  name?: string | null
  agentId?: string | null
  taskPrompt?: string | null
  scheduleType?: ScheduleType | string | null
  cron?: string | null
  intervalMs?: number | null
  runAt?: number | null
  timezone?: string | null
  staggerSec?: number | null
  nextRunAt?: number | null
  status?: string | null
}

export type ScheduleNextRunRepairAssessment =
  | { ok: true; repair: false }
  | {
      ok: true
      repair: true
      reason: ScheduleTimingRepairReason
      nextRunAt: number
      previousNextRunAt: number | null
    }
  | {
      ok: false
      reason: 'invalid_cron'
      previousNextRunAt: number | null
    }

const CRON_REPAIR_TOLERANCE_MS = 1_000

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : null
}

function normalizeNow(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : Date.now()
}

function normalizeStaggerWindowMs(staggerSec: unknown): number {
  if (typeof staggerSec !== 'number' || !Number.isFinite(staggerSec) || staggerSec <= 0) return 0
  return Math.min(Math.trunc(staggerSec * 1000), Number.MAX_SAFE_INTEGER)
}

function stableScheduleKey(schedule: ScheduleTimingInput): string {
  return [
    trimString(schedule.id),
    trimString(schedule.agentId),
    trimString(schedule.name),
    trimString(schedule.taskPrompt),
    trimString(schedule.scheduleType),
    trimString(schedule.cron),
    typeof schedule.intervalMs === 'number' && Number.isFinite(schedule.intervalMs) ? Math.trunc(schedule.intervalMs) : '',
    typeof schedule.runAt === 'number' && Number.isFinite(schedule.runAt) ? Math.trunc(schedule.runAt) : '',
    trimString(schedule.timezone),
  ].join('\0')
}

export function stableScheduleStaggerMs(schedule: ScheduleTimingInput): number {
  const windowMs = normalizeStaggerWindowMs(schedule.staggerSec)
  if (windowMs <= 0) return 0
  const digest = createHash('sha256').update(stableScheduleKey(schedule)).digest()
  const value = digest.readBigUInt64BE(0)
  return Number(value % BigInt(windowMs))
}

function applyStableStagger(timestamp: number, schedule: ScheduleTimingInput): number {
  return Math.trunc(timestamp + stableScheduleStaggerMs(schedule))
}

function parseCron(schedule: ScheduleTimingInput, now: number) {
  const cron = trimString(schedule.cron)
  if (!cron) return null
  const timezone = trimString(schedule.timezone)
  return CronExpressionParser.parse(cron, {
    ...(timezone ? { tz: timezone } : {}),
    currentDate: new Date(normalizeNow(now)),
  })
}

export function computeScheduleNextRunAt(schedule: ScheduleTimingInput, now: number): number | undefined {
  const scheduleType = trimString(schedule.scheduleType)
  if (scheduleType === 'once') {
    const runAt = normalizeTimestamp(schedule.runAt)
    return runAt == null ? undefined : applyStableStagger(runAt, schedule)
  }
  if (scheduleType === 'interval') {
    const intervalMs = normalizeTimestamp(schedule.intervalMs)
    return intervalMs == null ? undefined : applyStableStagger(normalizeNow(now) + intervalMs, schedule)
  }
  if (scheduleType === 'cron') {
    const interval = parseCron(schedule, now)
    if (!interval) return undefined
    return applyStableStagger(interval.next().getTime(), schedule)
  }
  return undefined
}

function computeCronWindow(schedule: ScheduleTimingInput, now: number): { earliest: number; latest: number; nextRunAt: number } | null {
  const interval = parseCron(schedule, now)
  if (!interval) return null
  const earliest = interval.next().getTime()
  const latest = earliest + normalizeStaggerWindowMs(schedule.staggerSec)
  return {
    earliest,
    latest,
    nextRunAt: applyStableStagger(earliest, schedule),
  }
}

export function assessScheduleNextRunRepair(
  schedule: ScheduleTimingInput,
  now: number,
): ScheduleNextRunRepairAssessment {
  if (trimString(schedule.status) && trimString(schedule.status) !== 'active') return { ok: true, repair: false }

  const previousNextRunAt = normalizeTimestamp(schedule.nextRunAt)
  const hasNextRunAt = schedule.nextRunAt != null
  if (previousNextRunAt != null && previousNextRunAt <= normalizeNow(now)) {
    if (trimString(schedule.scheduleType) === 'cron') {
      try {
        if (!parseCron(schedule, now)) return { ok: false, reason: 'invalid_cron', previousNextRunAt }
      } catch {
        return { ok: false, reason: 'invalid_cron', previousNextRunAt }
      }
    }
    return { ok: true, repair: false }
  }

  if (previousNextRunAt == null) {
    try {
      const nextRunAt = computeScheduleNextRunAt(schedule, now)
      if (nextRunAt == null) return { ok: true, repair: false }
      return {
        ok: true,
        repair: true,
        reason: hasNextRunAt ? 'invalid' : 'missing',
        nextRunAt,
        previousNextRunAt: null,
      }
    } catch {
      return { ok: false, reason: 'invalid_cron', previousNextRunAt: null }
    }
  }

  if (trimString(schedule.scheduleType) !== 'cron') return { ok: true, repair: false }

  try {
    const window = computeCronWindow(schedule, now)
    if (!window) return { ok: true, repair: false }
    const tooEarly = previousNextRunAt < window.earliest - CRON_REPAIR_TOLERANCE_MS
    const tooLate = previousNextRunAt > window.latest + CRON_REPAIR_TOLERANCE_MS
    if (!tooEarly && !tooLate) return { ok: true, repair: false }
    return {
      ok: true,
      repair: true,
      reason: 'stale_future',
      nextRunAt: window.nextRunAt,
      previousNextRunAt,
    }
  } catch {
    return { ok: false, reason: 'invalid_cron', previousNextRunAt }
  }
}
