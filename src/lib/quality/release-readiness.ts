import type { EvalGateResult } from '@/lib/server/eval/types'
import type { ArchitectureHealthReport } from '@/lib/quality/architecture-health'
import type { OperationPulse, OperationPulseAction, OperationPulseRange } from '@/types'

export type ReleaseReadinessStatus = 'ready' | 'warning' | 'blocked'

export interface ReleaseReadinessCheck {
  code: string
  status: ReleaseReadinessStatus
  title: string
  summary: string
  href?: string
  evidence?: string[]
}

export interface ReleaseReadinessReport {
  generatedAt: number
  range: OperationPulseRange
  status: ReleaseReadinessStatus
  score: number
  blockerCount: number
  warningCount: number
  pulse: OperationPulse
  evalGate: EvalGateResult | null
  architectureHealth: ArchitectureHealthReport | null
  checks: ReleaseReadinessCheck[]
  nextActions: OperationPulseAction[]
}

const BLOCKER_PENALTY = 30
const WARNING_PENALTY = 10

function readinessStatus(checks: ReleaseReadinessCheck[]): ReleaseReadinessStatus {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked'
  if (checks.some((check) => check.status === 'warning')) return 'warning'
  return 'ready'
}

function readinessScore(checks: ReleaseReadinessCheck[]): number {
  const penalty = checks.reduce((sum, check) => {
    if (check.status === 'blocked') return sum + BLOCKER_PENALTY
    if (check.status === 'warning') return sum + WARNING_PENALTY
    return sum
  }, 0)
  return Math.max(0, 100 - penalty)
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`
}

function addCheck(checks: ReleaseReadinessCheck[], check: ReleaseReadinessCheck): void {
  checks.push(check)
}

export function buildReleaseReadinessReport(input: {
  pulse: OperationPulse
  evalGate?: EvalGateResult | null
  architectureHealth?: ArchitectureHealthReport | null
}): ReleaseReadinessReport {
  const checks: ReleaseReadinessCheck[] = []
  const evalGate = input.evalGate ?? null
  const architectureHealth = input.architectureHealth ?? null

  if (!evalGate) {
    addCheck(checks, {
      code: 'eval_gate_missing',
      status: 'warning',
      title: 'Select an eval gate',
      summary: 'No eval regression gate is included in this readiness report.',
      href: '/quality?tab=evals',
    })
  } else if (evalGate.status === 'fail') {
    addCheck(checks, {
      code: 'eval_gate_failed',
      status: 'blocked',
      title: 'Eval gate failed',
      summary: `${evalGate.scope.label} is not passing the configured eval release gate.`,
      href: '/quality?tab=evals',
      evidence: evalGate.checks
        .filter((check) => check.status === 'fail')
        .map((check) => check.message),
    })
  } else if (evalGate.status === 'warn') {
    addCheck(checks, {
      code: 'eval_gate_warning',
      status: 'warning',
      title: 'Eval gate needs a baseline',
      summary: `${evalGate.scope.label} passes the score threshold but still has release-gate warnings.`,
      href: '/quality?tab=evals',
      evidence: evalGate.checks
        .filter((check) => check.status === 'warn')
        .map((check) => check.message),
    })
  } else {
    addCheck(checks, {
      code: 'eval_gate_passed',
      status: 'ready',
      title: 'Eval gate passed',
      summary: `${evalGate.scope.label} meets the configured score and regression checks.`,
      href: '/quality?tab=evals',
      evidence: [`${evalGate.currentPercent ?? 'n/a'}% current score`],
    })
  }

  if (input.pulse.kpis.failedRuns > 0) {
    addCheck(checks, {
      code: 'failed_runs_present',
      status: 'blocked',
      title: 'Failed runs need review',
      summary: `${plural(input.pulse.kpis.failedRuns, 'failed run')} found in the ${input.pulse.range} operations window.`,
      href: '/quality?tab=runs',
    })
  }

  if (input.pulse.kpis.pendingApprovals > 0) {
    addCheck(checks, {
      code: 'pending_approvals_present',
      status: 'blocked',
      title: 'Pending approvals need decisions',
      summary: `${plural(input.pulse.kpis.pendingApprovals, 'approval')} still waiting on an operator.`,
      href: '/quality?tab=approvals',
    })
  }

  if (input.pulse.kpis.runningRuns > 0) {
    addCheck(checks, {
      code: 'active_runs_present',
      status: 'warning',
      title: 'Runs are still active',
      summary: `${plural(input.pulse.kpis.runningRuns, 'run')} queued or running while this report was generated.`,
      href: '/runs',
    })
  }

  if (input.pulse.kpis.connectorAttention > 0) {
    addCheck(checks, {
      code: 'connector_attention_present',
      status: 'warning',
      title: 'Connector readiness needs attention',
      summary: `${plural(input.pulse.kpis.connectorAttention, 'connector')} reporting degraded readiness.`,
      href: '/connectors',
    })
  }

  if (input.pulse.kpis.gatewayAttention > 0) {
    addCheck(checks, {
      code: 'gateway_attention_present',
      status: 'warning',
      title: 'Gateway readiness needs attention',
      summary: `${plural(input.pulse.kpis.gatewayAttention, 'gateway')} reporting topology or environment warnings.`,
      href: '/providers',
    })
  }

  if (input.pulse.kpis.budgetWarnings > 0) {
    addCheck(checks, {
      code: 'budget_warnings_present',
      status: 'warning',
      title: 'Mission budget pressure',
      summary: `${plural(input.pulse.kpis.budgetWarnings, 'mission')} near a configured budget limit.`,
      href: '/missions',
    })
  }

  if (input.pulse.kpis.activeMissions > 0) {
    addCheck(checks, {
      code: 'active_missions_present',
      status: 'warning',
      title: 'Missions are still active',
      summary: `${plural(input.pulse.kpis.activeMissions, 'mission')} running or paused in the operations window.`,
      href: '/missions',
    })
  }

  if (architectureHealth) {
    if (architectureHealth.status === 'risk') {
      addCheck(checks, {
        code: 'architecture_health_risk',
        status: 'blocked',
        title: 'Architecture health has risks',
        summary: `${plural(architectureHealth.riskCount, 'architecture risk')} need review before release.`,
        href: '/quality',
        evidence: architectureHealth.nextActions.map((action) => action.summary),
      })
    } else if (architectureHealth.status === 'watch') {
      addCheck(checks, {
        code: 'architecture_health_watch',
        status: 'warning',
        title: 'Architecture health needs review',
        summary: `${plural(architectureHealth.warningCount, 'architecture warning')} found in runtime ownership checks.`,
        href: '/quality',
        evidence: architectureHealth.nextActions.map((action) => action.summary),
      })
    } else {
      addCheck(checks, {
        code: 'architecture_health_passed',
        status: 'ready',
        title: 'Architecture health passed',
        summary: 'Dispatch, memory, startup, and quality surfaces have mapped owners, guardrails, and test evidence.',
        href: '/quality',
        evidence: [`${architectureHealth.score} health score`],
      })
    }
  }

  const blockerCount = checks.filter((check) => check.status === 'blocked').length
  const warningCount = checks.filter((check) => check.status === 'warning').length

  return {
    generatedAt: input.pulse.generatedAt,
    range: input.pulse.range,
    status: readinessStatus(checks),
    score: readinessScore(checks),
    blockerCount,
    warningCount,
    pulse: input.pulse,
    evalGate,
    architectureHealth,
    checks,
    nextActions: input.pulse.actions.slice(0, 8),
  }
}
