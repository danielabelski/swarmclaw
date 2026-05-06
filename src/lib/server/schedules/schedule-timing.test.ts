import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  assessScheduleNextRunRepair,
  computeScheduleNextRunAt,
  stableScheduleStaggerMs,
} from '@/lib/server/schedules/schedule-timing'

describe('schedule timing', () => {
  it('computes cron next runs from the provided scheduler time', () => {
    const nextRunAt = computeScheduleNextRunAt({
      id: 'sched-daily',
      name: 'Daily status',
      agentId: 'agent-1',
      scheduleType: 'cron',
      cron: '0 8 * * *',
      timezone: 'UTC',
    }, Date.parse('2030-01-01T08:00:30.000Z'))

    assert.equal(nextRunAt, Date.parse('2030-01-02T08:00:00.000Z'))
  })

  it('uses deterministic schedule stagger inside the configured window', () => {
    const schedule = {
      id: 'sched-staggered',
      name: 'Staggered status',
      agentId: 'agent-1',
      scheduleType: 'cron',
      cron: '0 8 * * *',
      timezone: 'UTC',
      staggerSec: 30,
    }

    const first = stableScheduleStaggerMs(schedule)
    const second = stableScheduleStaggerMs(schedule)

    assert.equal(first, second)
    assert.ok(first >= 0)
    assert.ok(first < 30_000)
  })

  it('repairs stale future cron slots to the earliest upcoming slot', () => {
    const assessment = assessScheduleNextRunRepair({
      id: 'sched-stale',
      name: 'Daily status',
      agentId: 'agent-1',
      scheduleType: 'cron',
      cron: '0 8 * * *',
      timezone: 'UTC',
      status: 'active',
      nextRunAt: Date.parse('2026-05-12T08:00:00.000Z'),
    }, Date.parse('2026-05-06T07:30:00.000Z'))

    assert.equal(assessment.ok, true)
    assert.equal(assessment.repair, true)
    if (assessment.ok && assessment.repair) {
      assert.equal(assessment.reason, 'stale_future')
      assert.equal(assessment.nextRunAt, Date.parse('2026-05-06T08:00:00.000Z'))
    }
  })

  it('flags invalid due cron schedules before they launch', () => {
    const assessment = assessScheduleNextRunRepair({
      id: 'sched-invalid',
      name: 'Broken cron',
      agentId: 'agent-1',
      scheduleType: 'cron',
      cron: 'not a cron',
      status: 'active',
      nextRunAt: Date.parse('2026-05-06T07:00:00.000Z'),
    }, Date.parse('2026-05-06T07:30:00.000Z'))

    assert.equal(assessment.ok, false)
    if (!assessment.ok) {
      assert.equal(assessment.reason, 'invalid_cron')
      assert.equal(assessment.previousNextRunAt, Date.parse('2026-05-06T07:00:00.000Z'))
    }
  })
})
