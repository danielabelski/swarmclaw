import type { EvalRun } from '@/lib/server/eval/types'
import type { ApprovalCategory, ApprovalRequest, SessionRunRecord, SessionRunStatus } from '@/types'

const RUN_STATUSES: SessionRunStatus[] = ['queued', 'running', 'completed', 'failed', 'cancelled']

export interface RunHealthSummary {
  total: number
  byStatus: Record<SessionRunStatus, number>
  activeCount: number
  needsAttentionCount: number
  recentFailures: SessionRunRecord[]
}

export interface EvalRunSummary {
  totalRuns: number
  completedRuns: number
  failedRuns: number
  averagePercent: number | null
  latestCompletedPercent: number | null
  latestRun: EvalRun | null
}

export interface ApprovalCategoryGroup {
  category: ApprovalCategory
  count: number
  approvals: ApprovalRequest[]
}

export interface ApprovalGroupSummary {
  totalPending: number
  categories: ApprovalCategoryGroup[]
}

export interface QualityOverviewSummary {
  runHealth: RunHealthSummary
  evals: EvalRunSummary
  approvals: ApprovalGroupSummary
  needsAttention: number
  pendingApprovals: number
  activeRuns: number
  evalAveragePercent: number | null
}

function newestRunTimestamp(run: SessionRunRecord): number {
  return run.endedAt ?? run.startedAt ?? run.queuedAt
}

function evalTimestamp(run: EvalRun): number {
  return run.endedAt ?? run.startedAt
}

function percent(score: number, maxScore: number): number | null {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return null
  return Math.round((score / maxScore) * 100)
}

export function summarizeRunHealth(runs: SessionRunRecord[], opts: { recentFailureLimit?: number } = {}): RunHealthSummary {
  const byStatus = RUN_STATUSES.reduce((acc, status) => {
    acc[status] = 0
    return acc
  }, {} as Record<SessionRunStatus, number>)

  for (const run of runs) {
    byStatus[run.status] = (byStatus[run.status] ?? 0) + 1
  }

  const recentFailures = runs
    .filter((run) => run.status === 'failed')
    .slice()
    .sort((a, b) => newestRunTimestamp(b) - newestRunTimestamp(a))
    .slice(0, opts.recentFailureLimit ?? 5)

  return {
    total: runs.length,
    byStatus,
    activeCount: byStatus.queued + byStatus.running,
    needsAttentionCount: byStatus.failed,
    recentFailures,
  }
}

export function summarizeEvalRuns(runs: EvalRun[]): EvalRunSummary {
  const latestRun = runs.length
    ? runs.slice().sort((a, b) => evalTimestamp(b) - evalTimestamp(a))[0]
    : null
  const completed = runs.filter((run) => run.status === 'completed')
  const failedRuns = runs.filter((run) => run.status === 'failed').length
  const completedPercents = completed
    .map((run) => percent(run.score, run.maxScore))
    .filter((value): value is number => value !== null)

  const latestCompleted = completed.length
    ? completed.slice().sort((a, b) => evalTimestamp(b) - evalTimestamp(a))[0]
    : null
  const latestCompletedPercent = latestCompleted
    ? percent(latestCompleted.score, latestCompleted.maxScore)
    : null

  return {
    totalRuns: runs.length,
    completedRuns: completed.length,
    failedRuns,
    averagePercent: completedPercents.length
      ? Math.round(completedPercents.reduce((sum, value) => sum + value, 0) / completedPercents.length)
      : null,
    latestCompletedPercent,
    latestRun,
  }
}

export function groupApprovalsByCategory(approvals: ApprovalRequest[]): ApprovalGroupSummary {
  const pending = approvals
    .filter((approval) => approval.status === 'pending')
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
  const groups = new Map<ApprovalCategory, ApprovalRequest[]>()

  for (const approval of pending) {
    const items = groups.get(approval.category) ?? []
    items.push(approval)
    groups.set(approval.category, items)
  }

  return {
    totalPending: pending.length,
    categories: Array.from(groups.entries())
      .map(([category, items]) => ({ category, count: items.length, approvals: items }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
  }
}

export function buildQualityOverviewSummary(params: {
  runs: SessionRunRecord[]
  evalRuns: EvalRun[]
  approvals: ApprovalRequest[]
}): QualityOverviewSummary {
  const runHealth = summarizeRunHealth(params.runs)
  const evals = summarizeEvalRuns(params.evalRuns)
  const approvals = groupApprovalsByCategory(params.approvals)

  return {
    runHealth,
    evals,
    approvals,
    needsAttention: runHealth.needsAttentionCount + evals.failedRuns + approvals.totalPending,
    pendingApprovals: approvals.totalPending,
    activeRuns: runHealth.activeCount,
    evalAveragePercent: evals.averagePercent,
  }
}
