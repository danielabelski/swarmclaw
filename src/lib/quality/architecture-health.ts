export type ArchitectureHealthStatus = 'healthy' | 'watch' | 'risk'

export type ArchitectureSurfaceKind =
  | 'dispatch'
  | 'memory'
  | 'startup'
  | 'quality'

export interface ArchitectureHealthSurface {
  id: string
  title: string
  kind: ArchitectureSurfaceKind
  path: string
  description: string
  guardrails: string[]
  evidence: string[]
}

export interface ArchitectureHealthDomainInput {
  id: string
  title: string
  summary: string
  owner: string
  surfaces: ArchitectureHealthSurface[]
  testPaths: string[]
}

export interface ArchitectureHealthCheck {
  code: string
  status: ArchitectureHealthStatus
  title: string
  summary: string
  evidence?: string[]
  href?: string
}

export interface ArchitectureHealthDomain extends ArchitectureHealthDomainInput {
  status: ArchitectureHealthStatus
  score: number
  checkCodes: string[]
}

export interface ArchitectureHealthAction {
  id: string
  severity: Exclude<ArchitectureHealthStatus, 'healthy'>
  title: string
  summary: string
  href: string
  evidence: string[]
}

export interface ArchitectureHealthReport {
  generatedAt: number
  status: ArchitectureHealthStatus
  score: number
  domainCount: number
  surfaceCount: number
  guardrailCount: number
  riskCount: number
  warningCount: number
  domains: ArchitectureHealthDomain[]
  checks: ArchitectureHealthCheck[]
  nextActions: ArchitectureHealthAction[]
}

const WATCH_PENALTY = 10
const RISK_PENALTY = 30

export const DEFAULT_ARCHITECTURE_HEALTH_INVENTORY: ArchitectureHealthDomainInput[] = [
  {
    id: 'dispatch',
    title: 'Dispatch Boundaries',
    summary: 'Agent, task, protocol, connector, and tool execution paths that can start model or tool work.',
    owner: 'runtime',
    surfaces: [
      {
        id: 'agent-loop',
        title: 'Agent loop dispatch',
        kind: 'dispatch',
        path: 'src/lib/server/agents/main-agent-loop.ts',
        description: 'Main chat and autonomous run loop for agent turns.',
        guardrails: ['tool capability policy', 'approval hooks', 'mission budgets', 'structured internal payload stripping'],
        evidence: ['WorkingStatePatchSchema', 'MessageClassificationSchema', 'ResponseCompletenessSchema'],
      },
      {
        id: 'protocol-runs',
        title: 'Protocol run dispatch',
        kind: 'dispatch',
        path: 'src/lib/server/protocols/protocol-service.ts',
        description: 'Visual protocol runner, DAG lifecycle, and step processors.',
        guardrails: ['DAG validation', 'run lifecycle repository', 'step output contracts'],
        evidence: ['protocol-service.test.ts', 'protocol-normalization.test.ts', 'protocol-foreach.test.ts'],
      },
      {
        id: 'task-execution',
        title: 'Task execution dispatch',
        kind: 'dispatch',
        path: 'src/lib/server/tasks/task-service.ts',
        description: 'Task creation, execution workspace, liveness, handoff, and quality gates.',
        guardrails: ['task execution policy', 'task quality gate', 'handoff packet readiness checks'],
        evidence: ['task-execution-policy.test.ts', 'task-validation.test.ts', 'task-handoff.test.ts'],
      },
      {
        id: 'connector-ingress',
        title: 'Connector ingress dispatch',
        kind: 'dispatch',
        path: 'src/lib/server/connectors/connector-service.ts',
        description: 'Inbound connector messages routed into sessions or rooms.',
        guardrails: ['connector schema validation', 'readiness checks', 'routing tests'],
        evidence: ['connector-routing.test.ts', 'email.test.ts', 'filequeue.test.ts'],
      },
      {
        id: 'session-tools',
        title: 'Session tool dispatch',
        kind: 'dispatch',
        path: 'src/lib/server/session-tools.ts',
        description: 'Tool registry, session tool execution, and managed tool surfaces.',
        guardrails: ['zod tool schemas', 'capability router', 'approval matching'],
        evidence: ['tool-capability-policy.test.ts', 'universal-tool-access.test.ts', 'manage-tasks.test.ts'],
      },
    ],
    testPaths: [
      'src/lib/server/agents/agent-runtime-config.test.ts',
      'src/lib/server/protocols/protocol-service.test.ts',
      'src/lib/server/tasks/task-execution-policy.test.ts',
      'src/lib/server/connectors/connector-routing.test.ts',
      'src/lib/server/tool-capability-policy.test.ts',
    ],
  },
  {
    id: 'memory',
    title: 'Memory Ownership',
    summary: 'Authoritative working state, long-term memory, graph retrieval, and archive surfaces.',
    owner: 'memory',
    surfaces: [
      {
        id: 'working-state',
        title: 'Working state service',
        kind: 'memory',
        path: 'src/lib/server/working-state/service.ts',
        description: 'Structured short-term state and fact extraction for active sessions.',
        guardrails: ['zod schemas', 'normalization', 'repository boundary'],
        evidence: ['working-state/service.test.ts', 'working-state/extraction.ts'],
      },
      {
        id: 'memory-policy',
        title: 'Memory policy',
        kind: 'memory',
        path: 'src/lib/server/memory/memory-policy.ts',
        description: 'Controls what can be written, retained, consolidated, and recalled.',
        guardrails: ['policy tests', 'session memory scope', 'temporal decay'],
        evidence: ['memory-policy.test.ts', 'session-memory-scope.test.ts'],
      },
      {
        id: 'memory-graph',
        title: 'Memory graph',
        kind: 'memory',
        path: 'src/lib/server/memory/memory-graph.ts',
        description: 'Graph relationships and retrieval context for long-running work.',
        guardrails: ['graph tests', 'memory retrieval tests', 'MMR ranking'],
        evidence: ['memory-graph.test.ts', 'memory-retrieval.test.ts'],
      },
      {
        id: 'session-archive',
        title: 'Session archive memory',
        kind: 'memory',
        path: 'src/lib/server/memory/session-archive-memory.ts',
        description: 'Archived session memory used after compaction or long-running autonomous work.',
        guardrails: ['archive tests', 'freshness boundaries', 'session ownership'],
        evidence: ['session-archive-memory.test.ts', 'memory-consolidation.test.ts'],
      },
    ],
    testPaths: [
      'src/lib/server/working-state/service.test.ts',
      'src/lib/server/memory/memory-policy.test.ts',
      'src/lib/server/memory/memory-graph.test.ts',
      'src/lib/server/memory/session-archive-memory.test.ts',
    ],
  },
  {
    id: 'startup',
    title: 'Startup Entry Points',
    summary: 'CLI, web, desktop, daemon, and packaging paths that bootstrap the runtime.',
    owner: 'platform',
    surfaces: [
      {
        id: 'cli-server',
        title: 'CLI server entry',
        kind: 'startup',
        path: 'src/cli/index.ts',
        description: 'Package CLI, command routing, server start, and API command coverage.',
        guardrails: ['API route coverage guard', 'binary router tests', 'pack dry run'],
        evidence: ['src/cli/index.test.js', 'bin/swarmclaw.js'],
      },
      {
        id: 'next-app',
        title: 'Next app runtime',
        kind: 'startup',
        path: 'src/app',
        description: 'Self-hosted web UI and API routes.',
        guardrails: ['health route', 'browser smoke', 'type-check'],
        evidence: ['healthz/route.test.ts', 'scripts/browser-e2e-smoke.ts'],
      },
      {
        id: 'desktop-wrapper',
        title: 'Desktop wrapper',
        kind: 'startup',
        path: 'electron/main.ts',
        description: 'Electron wrapper around the standalone server with app-owned data directories.',
        guardrails: ['local-only bind host', 'userData home root', 'native module rebuild smoke'],
        evidence: ['scripts/build-electron.mjs', 'scripts/electron-after-pack.test.mjs'],
      },
      {
        id: 'daemon',
        title: 'Daemon lifecycle',
        kind: 'startup',
        path: 'src/app/api/daemon/route.ts',
        description: 'Runtime daemon start, stop, health checks, and status paths.',
        guardrails: ['daemon health check', 'safe action schema', 'CLI mapping'],
        evidence: ['src/cli/index.test.js', 'src/app/api/daemon/health-check/route.ts'],
      },
    ],
    testPaths: [
      'src/cli/index.test.js',
      'src/app/api/healthz/route.test.ts',
      'scripts/electron-after-pack.test.mjs',
      'scripts/browser-e2e-smoke.ts',
    ],
  },
  {
    id: 'quality',
    title: 'Quality Evidence',
    summary: 'Operator evidence surfaces that turn runtime state into release decisions.',
    owner: 'quality',
    surfaces: [
      {
        id: 'release-readiness',
        title: 'Release readiness',
        kind: 'quality',
        path: 'src/lib/quality/release-readiness.ts',
        description: 'Combines eval gates, operations pulse, approvals, budgets, and runtime readiness.',
        guardrails: ['scored report', 'blocker and warning counts', 'next actions'],
        evidence: ['release-readiness.test.ts', '/api/quality/release-readiness'],
      },
      {
        id: 'operations-pulse',
        title: 'Operations pulse',
        kind: 'quality',
        path: 'src/lib/server/operations/operation-pulse.ts',
        description: 'Shared triage queue for failed runs, approvals, connectors, gateways, and budgets.',
        guardrails: ['range normalization', 'severity ranking', 'operator hrefs'],
        evidence: ['operation-pulse.test.ts', '/api/operations/pulse'],
      },
      {
        id: 'eval-gates',
        title: 'Eval regression gates',
        kind: 'quality',
        path: 'src/lib/server/eval/baseline.ts',
        description: 'Compares latest eval evidence against thresholds and approved baselines.',
        guardrails: ['baseline scope', 'regression thresholds', 'CLI commands'],
        evidence: ['baseline.test.ts', '/api/eval/gate'],
      },
    ],
    testPaths: [
      'src/lib/quality/release-readiness.test.ts',
      'src/lib/server/operations/operation-pulse.test.ts',
      'src/lib/server/eval/baseline.test.ts',
    ],
  },
]

function worstStatus(statuses: ArchitectureHealthStatus[]): ArchitectureHealthStatus {
  if (statuses.includes('risk')) return 'risk'
  if (statuses.includes('watch')) return 'watch'
  return 'healthy'
}

function statusPenalty(status: ArchitectureHealthStatus): number {
  if (status === 'risk') return RISK_PENALTY
  if (status === 'watch') return WATCH_PENALTY
  return 0
}

function scoreFromChecks(checks: ArchitectureHealthCheck[]): number {
  const penalty = checks.reduce((sum, check) => sum + statusPenalty(check.status), 0)
  return Math.max(0, 100 - penalty)
}

function domainScore(checks: ArchitectureHealthCheck[]): number {
  const actionable = checks.filter((check) => check.status !== 'healthy')
  return scoreFromChecks(actionable)
}

function addCheck(checks: ArchitectureHealthCheck[], check: ArchitectureHealthCheck): void {
  checks.push(check)
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`
}

function buildDomainChecks(domain: ArchitectureHealthDomainInput): ArchitectureHealthCheck[] {
  const checks: ArchitectureHealthCheck[] = []

  if (!domain.owner.trim()) {
    addCheck(checks, {
      code: `${domain.id}_missing_owner`,
      status: 'risk',
      title: `${domain.title} needs an owner`,
      summary: 'This architecture domain does not declare an owner.',
      evidence: [domain.id],
    })
  }

  if (domain.surfaces.length === 0) {
    addCheck(checks, {
      code: `${domain.id}_missing_surfaces`,
      status: 'risk',
      title: `${domain.title} has no inventoried surfaces`,
      summary: 'A quality report cannot reason about this domain until its runtime surfaces are listed.',
      evidence: [domain.id],
    })
  }

  if (domain.testPaths.length === 0) {
    addCheck(checks, {
      code: `${domain.id}_missing_tests`,
      status: 'risk',
      title: `${domain.title} has no mapped test evidence`,
      summary: 'This domain needs at least one concrete test or verifier path before it can be treated as release-ready.',
      evidence: [domain.id],
    })
  }

  const unguarded = domain.surfaces.filter((surface) => surface.guardrails.length === 0)
  if (unguarded.length > 0) {
    addCheck(checks, {
      code: `${domain.id}_unguarded_surface`,
      status: 'watch',
      title: `${domain.title} has unguarded surfaces`,
      summary: `${plural(unguarded.length, 'surface')} missing explicit guardrails.`,
      evidence: unguarded.map((surface) => `${surface.title}: ${surface.path}`),
    })
  }

  return checks
}

function buildCrossDomainChecks(inventory: ArchitectureHealthDomainInput[]): ArchitectureHealthCheck[] {
  const checks: ArchitectureHealthCheck[] = []
  const surfaces = inventory.flatMap((domain) => domain.surfaces)
  const dispatchSurfaces = surfaces.filter((surface) => surface.kind === 'dispatch')
  const memoryDomain = inventory.find((domain) => domain.id === 'memory')
  const startupDomain = inventory.find((domain) => domain.id === 'startup')

  if (dispatchSurfaces.length > 0 && dispatchSurfaces.every((surface) => surface.guardrails.length > 0)) {
    addCheck(checks, {
      code: 'dispatch_guardrail_coverage',
      status: 'healthy',
      title: 'Dispatch surfaces declare guardrails',
      summary: `${plural(dispatchSurfaces.length, 'dispatch surface')} mapped to policy, approval, schema, or lifecycle controls.`,
      evidence: dispatchSurfaces.map((surface) => `${surface.title}: ${surface.guardrails.join(', ')}`),
      href: '/quality',
    })
  }

  if (memoryDomain && memoryDomain.surfaces.length >= 3 && memoryDomain.testPaths.length > 0) {
    addCheck(checks, {
      code: 'memory_authority',
      status: 'healthy',
      title: 'Memory ownership is explicit',
      summary: 'Working state, policy, graph, and archive surfaces are inventoried with test evidence.',
      evidence: memoryDomain.surfaces.map((surface) => surface.path),
      href: '/memory',
    })
  }

  if (startupDomain && startupDomain.surfaces.length >= 3 && startupDomain.testPaths.length > 0) {
    addCheck(checks, {
      code: 'startup_surface_inventory',
      status: 'healthy',
      title: 'Startup surfaces are inventoried',
      summary: 'CLI, web, desktop, and daemon entry points are tracked with smoke or route evidence.',
      evidence: startupDomain.surfaces.map((surface) => surface.path),
      href: '/settings',
    })
  }

  return checks
}

function makeAction(check: ArchitectureHealthCheck): ArchitectureHealthAction | null {
  if (check.status === 'healthy') return null
  return {
    id: check.code,
    severity: check.status,
    title: check.title,
    summary: check.summary,
    href: check.href || '/quality',
    evidence: check.evidence || [],
  }
}

export function buildArchitectureHealthReport(input: {
  generatedAt?: number
  inventory?: ArchitectureHealthDomainInput[]
} = {}): ArchitectureHealthReport {
  const generatedAt = input.generatedAt ?? Date.now()
  const inventory = input.inventory ?? DEFAULT_ARCHITECTURE_HEALTH_INVENTORY
  const domainChecks = new Map<string, ArchitectureHealthCheck[]>()
  const checks: ArchitectureHealthCheck[] = []

  for (const domain of inventory) {
    const nextChecks = buildDomainChecks(domain)
    domainChecks.set(domain.id, nextChecks)
    checks.push(...nextChecks)
  }

  checks.push(...buildCrossDomainChecks(inventory))

  const domains: ArchitectureHealthDomain[] = inventory.map((domain) => {
    const actionableChecks = domainChecks.get(domain.id) ?? []
    return {
      ...domain,
      status: worstStatus(actionableChecks.map((check) => check.status)),
      score: domainScore(actionableChecks),
      checkCodes: actionableChecks.map((check) => check.code),
    }
  })

  const actionableChecks = checks.filter((check) => check.status !== 'healthy')
  const reportStatus = worstStatus(actionableChecks.map((check) => check.status))
  const warningCount = actionableChecks.filter((check) => check.status === 'watch').length
  const riskCount = actionableChecks.filter((check) => check.status === 'risk').length

  return {
    generatedAt,
    status: reportStatus,
    score: scoreFromChecks(actionableChecks),
    domainCount: inventory.length,
    surfaceCount: inventory.reduce((sum, domain) => sum + domain.surfaces.length, 0),
    guardrailCount: inventory.reduce((sum, domain) => (
      sum + domain.surfaces.reduce((surfaceSum, surface) => surfaceSum + surface.guardrails.length, 0)
    ), 0),
    riskCount,
    warningCount,
    domains,
    checks,
    nextActions: actionableChecks.map(makeAction).filter((action): action is ArchitectureHealthAction => action !== null),
  }
}
