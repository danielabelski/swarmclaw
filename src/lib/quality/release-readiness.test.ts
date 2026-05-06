import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildArchitectureHealthReport } from './architecture-health'
import { buildReleaseReadinessReport } from './release-readiness'
import type { EvalGateResult } from '@/lib/server/eval/types'
import type { OperationPulse } from '@/types'

const now = 100_000

function pulse(overrides: Partial<OperationPulse> = {}): OperationPulse {
  return {
    generatedAt: now,
    range: '24h',
    windowStart: now - 86_400_000,
    kpis: {
      activeMissions: 0,
      runningRuns: 0,
      failedRuns: 0,
      pendingApprovals: 0,
      connectorAttention: 0,
      gatewayAttention: 0,
      budgetWarnings: 0,
    },
    actions: [],
    ...overrides,
  }
}

function evalGate(overrides: Partial<EvalGateResult> = {}): EvalGateResult {
  return {
    agentId: 'agent_1',
    scope: {
      type: 'suite',
      id: 'core',
      label: 'core',
      scenarioIds: ['coding-prime'],
    },
    status: 'pass',
    generatedAt: now,
    baseline: null,
    latestRuns: [],
    currentScore: 10,
    currentMaxScore: 10,
    currentPercent: 100,
    regressionPoints: 0,
    minPercent: 80,
    maxRegressionPoints: 5,
    checks: [{ code: 'score_threshold_met', status: 'pass', message: 'Current score meets the 80% gate.' }],
    ...overrides,
  }
}

describe('release readiness report', () => {
  it('passes when eval gate and operations pulse are clean', () => {
    const report = buildReleaseReadinessReport({
      pulse: pulse(),
      evalGate: evalGate(),
    })

    assert.equal(report.status, 'ready')
    assert.equal(report.score, 100)
    assert.equal(report.blockerCount, 0)
    assert.equal(report.warningCount, 0)
    assert.ok(report.checks.some((check) => check.code === 'eval_gate_passed'))
  })

  it('warns when no eval gate is selected', () => {
    const report = buildReleaseReadinessReport({
      pulse: pulse(),
      evalGate: null,
    })

    assert.equal(report.status, 'warning')
    assert.equal(report.blockerCount, 0)
    assert.equal(report.warningCount, 1)
    assert.ok(report.score < 100)
    assert.ok(report.checks.some((check) => check.code === 'eval_gate_missing'))
  })

  it('blocks when eval regression gate fails', () => {
    const report = buildReleaseReadinessReport({
      pulse: pulse(),
      evalGate: evalGate({
        status: 'fail',
        currentPercent: 60,
        checks: [{ code: 'score_below_threshold', status: 'fail', message: 'Current score is below the 80% gate.' }],
      }),
    })

    assert.equal(report.status, 'blocked')
    assert.equal(report.blockerCount, 1)
    assert.ok(report.score <= 70)
    assert.ok(report.checks.some((check) => check.code === 'eval_gate_failed'))
  })

  it('blocks on failed runs and pending approvals, then surfaces pulse actions', () => {
    const report = buildReleaseReadinessReport({
      pulse: pulse({
        kpis: {
          activeMissions: 1,
          runningRuns: 1,
          failedRuns: 2,
          pendingApprovals: 3,
          connectorAttention: 1,
          gatewayAttention: 1,
          budgetWarnings: 1,
        },
        actions: [{
          id: 'run:failed',
          kind: 'run',
          severity: 'high',
          title: 'Review failed run',
          summary: 'Run failed',
          href: '/quality?tab=runs',
          evidence: ['run'],
          createdAt: now,
        }],
      }),
      evalGate: evalGate(),
    })

    assert.equal(report.status, 'blocked')
    assert.equal(report.blockerCount, 2)
    assert.ok(report.warningCount >= 4)
    assert.equal(report.nextActions[0]?.id, 'run:failed')
    assert.ok(report.checks.some((check) => check.code === 'failed_runs_present'))
    assert.ok(report.checks.some((check) => check.code === 'pending_approvals_present'))
  })

  it('includes architecture health when supplied', () => {
    const report = buildReleaseReadinessReport({
      pulse: pulse(),
      evalGate: evalGate(),
      architectureHealth: buildArchitectureHealthReport({ generatedAt: now }),
    })

    assert.equal(report.status, 'ready')
    assert.equal(report.architectureHealth?.status, 'healthy')
    assert.ok(report.checks.some((check) => check.code === 'architecture_health_passed'))
  })
})
