import type { Connector } from '@/types'

export type ConnectorReadinessState = 'needs_setup' | 'attention' | 'healthy'
export type ConnectorReadinessCheckStatus = 'ready' | 'warning' | 'error'

export interface ConnectorReadinessCheck {
  id: 'credentials' | 'route' | 'pairing' | 'connection' | 'gateway' | 'queue'
  label: string
  status: ConnectorReadinessCheckStatus
  detail: string
  actionLabel?: string | null
  actionHref?: string | null
}

export interface ConnectorReadiness {
  state: ConnectorReadinessState
  summary: string
  checks: ConnectorReadinessCheck[]
  recentError: string | null
  doctorHref: string
  dashboardHref?: string | null
}

export function hasConnectorCredentials(connector: Connector): boolean {
  return connector.platform === 'whatsapp'
    || connector.platform === 'openclaw'
    || connector.platform === 'signal'
    || connector.platform === 'email'
    || connector.platform === 'filequeue'
    || connector.platform === 'swarmdock'
    || (connector.platform === 'bluebubbles' && (!!connector.credentialId || !!connector.config?.password))
    || !!connector.credentialId
}

function hasRoute(connector: Connector): boolean {
  return Boolean(connector.agentId || connector.chatroomId)
}

function connectionLabel(connector: Connector): string {
  if (connector.status === 'running') return 'Connected'
  if (connector.status === 'starting') return 'Starting'
  if (connector.status === 'error') return 'Error'
  return 'Stopped'
}

function openClawEndpointLabel(connector: Connector): string {
  const wsUrl = typeof connector.config?.wsUrl === 'string' && connector.config.wsUrl.trim()
    ? connector.config.wsUrl.trim()
    : 'ws://localhost:18789'
  return `Gateway ${wsUrl}`
}

export function getConnectorReadiness(connector: Connector): ConnectorReadiness {
  const credentialsReady = hasConnectorCredentials(connector)
  const routeReady = hasRoute(connector)
  const checks: ConnectorReadinessCheck[] = [
    connector.platform === 'filequeue'
      ? {
          id: 'queue',
          label: 'Queue folders',
          status: 'ready',
          detail: connector.config?.rootDir
            ? `Watching ${connector.config.rootDir}`
            : 'Using the managed local queue folder.',
        }
      : {
          id: 'credentials',
          label: 'Credentials',
          status: credentialsReady ? 'ready' : 'error',
          detail: credentialsReady ? 'Credential path is configured.' : 'Add the token, password, or pairing credential.',
        },
    {
      id: 'route',
      label: 'Route target',
      status: routeReady ? 'ready' : 'warning',
      detail: routeReady ? 'Inbound messages have an agent or room target.' : 'Choose an agent or chatroom route.',
    },
  ]

  if (connector.qrDataUrl) {
    checks.push({
      id: 'pairing',
      label: 'Pairing',
      status: 'warning',
      detail: 'Pairing is waiting for a QR scan.',
      actionLabel: 'Pair device',
    })
  }

  if (connector.platform === 'openclaw') {
    checks.push({
      id: 'gateway',
      label: 'OpenClaw Gateway',
      status: connector.status === 'error' ? 'error' : 'ready',
      detail: openClawEndpointLabel(connector),
      actionLabel: 'Dashboard',
      actionHref: connector.agentId
        ? `/api/openclaw/dashboard-url?agentId=${encodeURIComponent(connector.agentId)}`
        : null,
    })
  }

  checks.push({
    id: 'connection',
    label: 'Connection',
    status: connector.status === 'running'
      ? 'ready'
      : connector.status === 'error'
        ? 'error'
        : 'warning',
    detail: connector.lastError || connectionLabel(connector),
  })

  const hasError = checks.some((check) => check.status === 'error')
  const hasWarning = checks.some((check) => check.status === 'warning')
  const state: ConnectorReadinessState = hasError || !credentialsReady || !routeReady
    ? 'needs_setup'
    : hasWarning
      ? 'attention'
      : 'healthy'
  const summary = state === 'healthy'
    ? 'Ready for inbound autonomy'
    : state === 'attention'
      ? 'Configured, but not fully connected'
      : 'Setup work required before it can run'

  return {
    state,
    summary,
    checks,
    recentError: connector.lastError || null,
    doctorHref: `/api/connectors/${encodeURIComponent(connector.id)}/doctor`,
    dashboardHref: connector.platform === 'openclaw' && connector.agentId
      ? `/api/openclaw/dashboard-url?agentId=${encodeURIComponent(connector.agentId)}`
      : null,
  }
}
