import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildQualityOverviewSummary,
  groupApprovalsByCategory,
  summarizeEvalRuns,
  summarizeRunHealth,
} from './quality-summary'
import type { EvalRun } from '@/lib/server/eval/types'
import type { ApprovalRequest, SessionRunRecord } from '@/types'

function run(overrides: Partial<SessionRunRecord>): SessionRunRecord {
  return {
    id: overrides.id || 'run_1',
    sessionId: overrides.sessionId || 'sess_1',
    source: overrides.source || 'chat',
    internal: overrides.internal ?? false,
    mode: overrides.mode || 'direct',
    status: overrides.status || 'completed',
    messagePreview: overrides.messagePreview || 'hello',
    queuedAt: overrides.queuedAt ?? 1000,
    ...overrides,
  }
}

function evalRun(overrides: Partial<EvalRun>): EvalRun {
  return {
    id: overrides.id || 'eval_1',
    scenarioId: overrides.scenarioId || 'coding-prime',
    agentId: overrides.agentId || 'agent_1',
    status: overrides.status || 'completed',
    startedAt: overrides.startedAt ?? 1000,
    endedAt: overrides.endedAt,
    score: overrides.score ?? 8,
    maxScore: overrides.maxScore ?? 10,
    details: overrides.details || [],
    sessionId: overrides.sessionId,
    error: overrides.error,
  }
}

function approval(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: overrides.id || 'approval_1',
    category: overrides.category || 'human_loop',
    title: overrides.title || 'Review request',
    description: overrides.description,
    data: overrides.data || {},
    createdAt: overrides.createdAt ?? 1000,
    updatedAt: overrides.updatedAt ?? 1000,
    status: overrides.status || 'pending',
    agentId: overrides.agentId,
    sessionId: overrides.sessionId,
    taskId: overrides.taskId,
  }
}

describe('summarizeRunHealth', () => {
  it('counts run statuses and keeps the most recent failed runs', () => {
    const summary = summarizeRunHealth([
      run({ id: 'old-failed', status: 'failed', queuedAt: 1000 }),
      run({ id: 'running', status: 'running', queuedAt: 2000 }),
      run({ id: 'new-failed', status: 'failed', queuedAt: 3000 }),
      run({ id: 'completed', status: 'completed', queuedAt: 4000 }),
    ])

    assert.equal(summary.total, 4)
    assert.equal(summary.byStatus.failed, 2)
    assert.equal(summary.byStatus.running, 1)
    assert.equal(summary.activeCount, 1)
    assert.equal(summary.needsAttentionCount, 2)
    assert.deepEqual(summary.recentFailures.map((item) => item.id), ['new-failed', 'old-failed'])
  })
})

describe('summarizeEvalRuns', () => {
  it('summarizes completed evals and ignores failed runs for score averages', () => {
    const summary = summarizeEvalRuns([
      evalRun({ id: 'low', score: 4, maxScore: 10, startedAt: 2000 }),
      evalRun({ id: 'failed', status: 'failed', score: 0, maxScore: 10, startedAt: 3000 }),
      evalRun({ id: 'high', score: 9, maxScore: 10, startedAt: 4000 }),
    ])

    assert.equal(summary.totalRuns, 3)
    assert.equal(summary.completedRuns, 2)
    assert.equal(summary.failedRuns, 1)
    assert.equal(summary.latestRun?.id, 'high')
    assert.equal(summary.averagePercent, 65)
    assert.equal(summary.latestCompletedPercent, 90)
  })
})

describe('groupApprovalsByCategory', () => {
  it('groups pending approvals and sorts oldest first inside each category', () => {
    const grouped = groupApprovalsByCategory([
      approval({ id: 'new-human', category: 'human_loop', createdAt: 3000 }),
      approval({ id: 'approved-skill', category: 'extension_install', status: 'approved', createdAt: 1000 }),
      approval({ id: 'old-human', category: 'human_loop', createdAt: 1000 }),
      approval({ id: 'tool', category: 'tool_access', createdAt: 2000 }),
    ])

    assert.equal(grouped.totalPending, 3)
    assert.deepEqual(grouped.categories.map((category) => category.category), ['human_loop', 'tool_access'])
    assert.deepEqual(grouped.categories[0].approvals.map((item) => item.id), ['old-human', 'new-human'])
  })
})

describe('buildQualityOverviewSummary', () => {
  it('combines runs, evals, and approvals into operator action counts', () => {
    const summary = buildQualityOverviewSummary({
      runs: [run({ status: 'failed' }), run({ status: 'running' })],
      evalRuns: [evalRun({ score: 7, maxScore: 10 })],
      approvals: [approval({}), approval({ status: 'rejected' })],
    })

    assert.equal(summary.needsAttention, 2)
    assert.equal(summary.pendingApprovals, 1)
    assert.equal(summary.activeRuns, 1)
    assert.equal(summary.evalAveragePercent, 70)
  })
})
