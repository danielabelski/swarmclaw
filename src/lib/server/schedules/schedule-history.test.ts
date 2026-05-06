import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  applyScheduleCreationHistory,
  applyScheduleUpdateHistory,
  appendScheduleHistoryEntry,
  normalizeScheduleHistory,
} from '@/lib/server/schedules/schedule-history'
import type { Schedule } from '@/types'

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sched-1',
    name: 'Morning run',
    agentId: 'agent-1',
    taskPrompt: 'Do the thing',
    scheduleType: 'cron',
    cron: '40 10 * * *',
    timezone: 'UTC',
    status: 'active',
    createdAt: 0,
    updatedAt: 0,
    nextRunAt: Date.parse('2026-01-01T10:40:00.000Z'),
    ...overrides,
  }
}

describe('schedule history', () => {
  it('adds a creation entry with revision 1', () => {
    const schedule = applyScheduleCreationHistory(makeSchedule(), {
      now: 1_000,
      actor: 'user',
      createId: () => 'hist-1',
    })

    assert.equal(schedule.revision, 1)
    assert.equal(schedule.history?.length, 1)
    assert.equal(schedule.history?.[0]?.id, 'hist-1')
    assert.equal(schedule.history?.[0]?.action, 'created')
    assert.equal(schedule.history?.[0]?.revision, 1)
    assert.match(schedule.history?.[0]?.summary || '', /Morning run/)
  })

  it('records meaningful update changes and ignores bookkeeping fields', () => {
    const current = makeSchedule({
      revision: 1,
      history: [{
        id: 'hist-1',
        at: 1_000,
        actor: 'user',
        action: 'created',
        revision: 1,
        summary: 'Schedule created: "Morning run"',
      }],
    })
    const next = {
      ...current,
      name: 'Morning release run',
      cron: '45 10 * * *',
      updatedAt: 2_000,
    }

    const withHistory = applyScheduleUpdateHistory(current, next, {
      now: 2_000,
      actor: 'user',
      createId: () => 'hist-2',
    })

    assert.equal(withHistory.revision, 2)
    assert.equal(withHistory.history?.length, 2)
    assert.equal(withHistory.history?.[0]?.id, 'hist-2')
    assert.deepEqual(withHistory.history?.[0]?.changes?.map((change) => change.field), ['name', 'cron'])
  })

  it('does not append history for no-op updates', () => {
    const current = makeSchedule({
      revision: 1,
      history: [{
        id: 'hist-1',
        at: 1_000,
        actor: 'user',
        action: 'created',
        revision: 1,
        summary: 'Schedule created: "Morning run"',
      }],
    })

    const withHistory = applyScheduleUpdateHistory(current, {
      ...current,
      updatedAt: 2_000,
    }, {
      now: 2_000,
      actor: 'user',
      createId: () => 'hist-2',
    })

    assert.equal(withHistory.revision, 1)
    assert.equal(withHistory.history?.length, 1)
    assert.equal(withHistory.history?.[0]?.id, 'hist-1')
  })

  it('keeps only the latest retained entries', () => {
    let schedule = makeSchedule()
    for (let index = 0; index < 30; index += 1) {
      schedule = appendScheduleHistoryEntry(schedule, {
        now: index,
        actor: 'system',
        action: 'updated',
        summary: `entry ${index}`,
        createId: () => `hist-${index}`,
      })
    }

    const history = normalizeScheduleHistory(schedule.history)
    assert.equal(history.length, 25)
    assert.equal(history[0].id, 'hist-29')
    assert.equal(history[24].id, 'hist-5')
    assert.equal(schedule.revision, 30)
  })

  it('retains scheduler repair history entries', () => {
    const history = normalizeScheduleHistory([{
      id: 'hist-repair',
      at: 1_000,
      actor: 'system',
      action: 'repaired',
      revision: 1,
      summary: 'Schedule timing repaired',
    }])

    assert.equal(history.length, 1)
    assert.equal(history[0].action, 'repaired')
  })
})
