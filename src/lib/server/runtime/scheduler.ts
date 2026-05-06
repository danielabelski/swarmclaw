import { listAgents } from '@/lib/server/agents/agent-repository'
import { loadSchedules, upsertSchedule, upsertSchedules } from '@/lib/server/schedules/schedule-repository'
import { loadTasks, upsertTask } from '@/lib/server/tasks/task-repository'
import { enqueueTask } from '@/lib/server/runtime/queue'
import { pushMainLoopEventToMainSessions } from '@/lib/server/agents/main-agent-loop'
import { getScheduleSignatureKey } from '@/lib/schedules/schedule-dedupe'
import { dispatchWake } from '@/lib/server/runtime/wake-dispatcher'
import { processDueWatchJobs } from '@/lib/server/runtime/watch-jobs'
import { isAgentDisabled } from '@/lib/server/agents/agent-availability'
import { prepareScheduledTaskRun } from '@/lib/server/tasks/task-lifecycle'
import { ensureAgentThreadSession } from '@/lib/server/agents/agent-thread-session'
import { hasActiveProtocolRunForSchedule, launchProtocolRunForSchedule } from '@/lib/server/protocols/protocol-service'
import { hmrSingleton } from '@/lib/shared-utils'
import { log } from '@/lib/server/logger'
import { appendScheduleHistoryEntry } from '@/lib/server/schedules/schedule-history'
import { assessScheduleNextRunRepair, computeScheduleNextRunAt } from '@/lib/server/schedules/schedule-timing'
import type { Schedule } from '@/types'

const TAG = 'scheduler'

const TICK_INTERVAL = 60_000 // 60 seconds
const schedulerState = hmrSingleton('__swarmclaw_scheduler_state__', () => ({
  intervalId: null as ReturnType<typeof setInterval> | null,
}))

interface ScheduleTaskLike {
  status?: string
  sourceScheduleKey?: string | null
}

function resolveScheduleWakeSessionId(schedule: Schedule, agents: Record<string, unknown>): string | undefined {
  const createdInSessionId = typeof schedule.createdInSessionId === 'string'
    ? schedule.createdInSessionId.trim()
    : ''
  if (createdInSessionId) return createdInSessionId

  const agent = agents[schedule.agentId] as { threadSessionId?: string | null } | undefined
  const threadSessionId = typeof agent?.threadSessionId === 'string' ? agent.threadSessionId.trim() : ''
  if (threadSessionId) return threadSessionId
  return ensureAgentThreadSession(schedule.agentId)?.id
}

function shouldWakeScheduleSession(schedule: Schedule): boolean {
  return schedule.taskMode === 'wake_only'
}

function shouldLaunchScheduleProtocol(schedule: Schedule): boolean {
  return schedule.taskMode === 'protocol'
}

export function startScheduler() {
  if (schedulerState.intervalId) return
  log.info(TAG, 'Starting scheduler engine (60s tick)')

  // Compute initial timing and repair stale nextRunAt values before the first tick.
  computeNextRuns()

  schedulerState.intervalId = setInterval(tick, TICK_INTERVAL)
}

export function stopScheduler() {
  if (schedulerState.intervalId) {
    clearInterval(schedulerState.intervalId)
    schedulerState.intervalId = null
    log.info(TAG, 'Stopped scheduler engine')
  }
}

function computeNextRuns(now = Date.now()): Record<string, Schedule> {
  const schedules = loadSchedules()
  const changedEntries: Array<[string, Schedule]> = []
  for (const schedule of Object.values(schedules)) {
    if (schedule.status !== 'active') continue
    const assessment = assessScheduleNextRunRepair(schedule, now)
    if (!assessment.ok) {
      log.error(TAG, `Invalid cron for ${schedule.id}`)
      const failedSchedule = appendScheduleHistoryEntry({
        ...schedule,
        status: 'failed',
        updatedAt: now,
      }, {
        now,
        actor: 'system',
        action: 'failed',
        summary: `Schedule failed because cron could not be parsed: "${schedule.name}"`,
        changes: [{
          field: 'status',
          label: 'Status',
          before: 'active',
          after: 'failed',
        }],
        metadata: { reason: 'invalid_cron' },
      })
      schedules[schedule.id] = failedSchedule
      changedEntries.push([schedule.id, failedSchedule])
      continue
    }
    if (assessment.repair) {
      const repairedSchedule = appendScheduleHistoryEntry({
        ...schedule,
        nextRunAt: assessment.nextRunAt,
        updatedAt: now,
      }, {
        now,
        actor: 'system',
        action: 'repaired',
        summary: `Schedule timing repaired: "${schedule.name}"`,
        changes: [{
          field: 'nextRunAt',
          label: 'Next run',
          before: assessment.previousNextRunAt == null ? null : String(assessment.previousNextRunAt),
          after: String(assessment.nextRunAt),
        }],
        metadata: { reason: assessment.reason },
      })
      schedules[schedule.id] = repairedSchedule
      changedEntries.push([schedule.id, repairedSchedule])
    }
  }
  if (changedEntries.length > 0) upsertSchedules(changedEntries)
  return schedules
}

async function tick(now = Date.now()) {
  await processDueWatchJobs(now)
  const schedules = computeNextRuns(now)
  const agents = listAgents()
  const tasks = loadTasks()
  const inFlightScheduleKeys = new Set<string>(
    Object.values(tasks as Record<string, ScheduleTaskLike>)
      .filter((task) => task && (task.status === 'queued' || task.status === 'running'))
      .map((task) => (typeof task.sourceScheduleKey === 'string' ? task.sourceScheduleKey : ''))
      .filter((value: string) => value.length > 0),
  )

  const advanceSchedule = (schedule: Schedule): void => {
    if (schedule.scheduleType === 'once') {
      schedule.status = 'completed'
      schedule.nextRunAt = undefined
      return
    }

    try {
      const nextRunAt = computeScheduleNextRunAt(schedule, now)
      if (nextRunAt == null) {
        schedule.status = 'failed'
      } else {
        schedule.nextRunAt = nextRunAt
      }
    } catch {
      schedule.status = 'failed'
    }
  }

  for (const schedule of Object.values(schedules)) {
    if (schedule.status !== 'active') continue
    if (!schedule.nextRunAt || schedule.nextRunAt > now) continue

    const scheduleSignature = getScheduleSignatureKey(schedule)
    if (scheduleSignature && inFlightScheduleKeys.has(scheduleSignature)) {
      advanceSchedule(schedule)
      upsertSchedule(schedule.id, appendScheduleHistoryEntry(schedule, {
        now,
        actor: 'system',
        action: 'skipped',
        summary: `Schedule skipped because a run is already in flight: "${schedule.name}"`,
        metadata: { reason: 'in_flight' },
      }))
      continue
    }

    const agent = agents[schedule.agentId]
    if (!agent) {
      log.error(TAG, `Agent ${schedule.agentId} not found for schedule ${schedule.id}`)
      schedule.status = 'failed'
      upsertSchedule(schedule.id, appendScheduleHistoryEntry(schedule, {
        now,
        actor: 'system',
        action: 'failed',
        summary: `Schedule failed because agent was not found: "${schedule.name}"`,
        changes: [{
          field: 'status',
          label: 'Status',
          before: 'active',
          after: 'failed',
        }],
        metadata: { reason: 'agent_not_found' },
      }))
      pushMainLoopEventToMainSessions({
        type: 'schedule_failed',
        text: `Schedule failed: "${schedule.name}" (${schedule.id}) — agent ${schedule.agentId} not found.`,
      })
      continue
    }
    if (isAgentDisabled(agent)) {
      log.warn(TAG, `Skipping schedule "${schedule.name}" (${schedule.id}) because agent ${schedule.agentId} is disabled`)
      advanceSchedule(schedule)
      upsertSchedule(schedule.id, appendScheduleHistoryEntry(schedule, {
        now,
        actor: 'system',
        action: 'skipped',
        summary: `Schedule skipped because agent is disabled: "${schedule.name}"`,
        metadata: { reason: 'agent_disabled' },
      }))
      pushMainLoopEventToMainSessions({
        type: 'schedule_skipped',
        text: `Schedule skipped: "${schedule.name}" (${schedule.id}) — agent ${schedule.agentId} is disabled.`,
      })
      continue
    }

    log.info(TAG, `Firing schedule "${schedule.name}" (${schedule.id})`)
    schedule.lastRunAt = now
    schedule.runNumber = (schedule.runNumber || 0) + 1
    // Compute next run
    advanceSchedule(schedule)
    const firedSchedule = appendScheduleHistoryEntry(schedule, {
      now,
      actor: 'system',
      action: 'run_started',
      summary: `Schedule run started: "${schedule.name}"`,
      metadata: { runNumber: schedule.runNumber || 0 },
    })

    if (shouldWakeScheduleSession(firedSchedule)) {
      // Wake-only: no board task, just heartbeat the agent
      upsertSchedule(firedSchedule.id, firedSchedule)
      const wakeSessionId = resolveScheduleWakeSessionId(firedSchedule, agents as Record<string, unknown>)

      const wakeMessage = firedSchedule.message || `Schedule triggered: ${firedSchedule.name}`
      pushMainLoopEventToMainSessions({
        type: 'schedule_fired',
        text: `Schedule fired (wake-only): "${firedSchedule.name}" (${firedSchedule.id}) run #${firedSchedule.runNumber}`,
      })

      dispatchWake({
        mode: 'immediate',
        agentId: firedSchedule.agentId,
        ...(wakeSessionId ? { sessionId: wakeSessionId } : {}),
        eventId: `${firedSchedule.id}:${firedSchedule.runNumber}`,
        reason: 'schedule',
        source: `schedule:${firedSchedule.id}`,
        resumeMessage: wakeMessage,
        detail: `Run #${firedSchedule.runNumber} (wake-only).`,
      })
    } else if (shouldLaunchScheduleProtocol(firedSchedule)) {
      upsertSchedule(firedSchedule.id, firedSchedule)
      if (hasActiveProtocolRunForSchedule(firedSchedule.id)) continue
      const run = launchProtocolRunForSchedule(firedSchedule)
      pushMainLoopEventToMainSessions({
        type: 'schedule_fired',
        text: `Schedule fired: "${firedSchedule.name}" (${firedSchedule.id}) run #${firedSchedule.runNumber} — structured session ${run.id}`,
      })
    } else {
      // Default task mode: create a board task
      const { taskId } = prepareScheduledTaskRun({
        schedule: firedSchedule,
        tasks,
        now,
        scheduleSignature,
      })

      upsertTask(taskId, tasks[taskId])
      upsertSchedule(firedSchedule.id, firedSchedule)

      enqueueTask(taskId)
      if (scheduleSignature) inFlightScheduleKeys.add(scheduleSignature)
      pushMainLoopEventToMainSessions({
        type: 'schedule_fired',
        text: `Schedule fired: "${firedSchedule.name}" (${firedSchedule.id}) run #${firedSchedule.runNumber} — task ${taskId}`,
      })
    }
  }
}

export async function runSchedulerTickForTests(now: number): Promise<void> {
  await tick(now)
}

export function resolveScheduleWakeSessionIdForTests(
  schedule: Schedule,
  agents: Record<string, unknown>,
): string | undefined {
  return resolveScheduleWakeSessionId(schedule, agents)
}

export function shouldWakeScheduleSessionForTests(schedule: Schedule): boolean {
  return shouldWakeScheduleSession(schedule)
}
