import { NextResponse } from 'next/server'
import { evaluateEvalGate } from '@/lib/server/eval/baseline'
import { getOperationPulse, normalizeOperationPulseRange } from '@/lib/server/operations/operation-pulse'
import { buildArchitectureHealthReport } from '@/lib/quality/architecture-health'
import { buildReleaseReadinessReport } from '@/lib/quality/release-readiness'
import { errorMessage } from '@/lib/shared-utils'

export const dynamic = 'force-dynamic'

function parseNumberParam(value: string | null): number | null {
  if (value == null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const range = normalizeOperationPulseRange(searchParams.get('range'))
    const agentId = searchParams.get('agentId') || ''
    const pulse = getOperationPulse(range)
    const evalGate = agentId
      ? evaluateEvalGate({
        agentId,
        scenarioId: searchParams.get('scenarioId'),
        suite: searchParams.get('suite'),
        minPercent: parseNumberParam(searchParams.get('minPercent')),
        maxRegressionPoints: parseNumberParam(searchParams.get('maxRegressionPoints')),
      })
      : null

    return NextResponse.json(buildReleaseReadinessReport({
      pulse,
      evalGate,
      architectureHealth: buildArchitectureHealthReport(),
    }))
  } catch (err: unknown) {
    return NextResponse.json(
      { error: errorMessage(err) },
      { status: 500 },
    )
  }
}
