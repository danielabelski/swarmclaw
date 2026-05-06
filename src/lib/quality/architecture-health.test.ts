import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildArchitectureHealthReport,
  DEFAULT_ARCHITECTURE_HEALTH_INVENTORY,
} from './architecture-health'

describe('architecture health report', () => {
  it('summarizes the default runtime architecture inventory', () => {
    const report = buildArchitectureHealthReport({
      generatedAt: 100_000,
    })

    assert.equal(report.generatedAt, 100_000)
    assert.equal(report.status, 'healthy')
    assert.equal(report.score, 100)
    assert.equal(report.domainCount, DEFAULT_ARCHITECTURE_HEALTH_INVENTORY.length)
    assert.ok(report.surfaceCount >= 10)
    assert.ok(report.guardrailCount >= 8)
    assert.ok(report.checks.some((check) => check.code === 'dispatch_guardrail_coverage'))
    assert.ok(report.checks.some((check) => check.code === 'memory_authority'))
    assert.ok(report.checks.some((check) => check.code === 'startup_surface_inventory'))
  })

  it('warns when a domain has an unguarded surface', () => {
    const report = buildArchitectureHealthReport({
      generatedAt: 100_000,
      inventory: [{
        id: 'dispatch',
        title: 'Dispatch',
        summary: 'Test dispatch surface',
        owner: 'runtime',
        surfaces: [{
          id: 'direct',
          title: 'Direct run',
          kind: 'dispatch',
          path: 'src/lib/server/test.ts',
          description: 'A dispatch path without a guardrail.',
          guardrails: [],
          evidence: ['No policy attached'],
        }],
        testPaths: ['src/lib/server/test.test.ts'],
      }],
    })

    assert.equal(report.status, 'watch')
    assert.ok(report.score < 100)
    assert.equal(report.warningCount, 1)
    assert.ok(report.checks.some((check) => check.code === 'dispatch_unguarded_surface'))
  })

  it('marks missing test coverage as an architecture risk', () => {
    const report = buildArchitectureHealthReport({
      generatedAt: 100_000,
      inventory: [{
        id: 'startup',
        title: 'Startup',
        summary: 'Startup entry points',
        owner: 'runtime',
        surfaces: [{
          id: 'cli',
          title: 'CLI',
          kind: 'startup',
          path: 'src/cli/index.js',
          description: 'CLI startup surface.',
          guardrails: ['route coverage'],
          evidence: ['CLI starts the server'],
        }],
        testPaths: [],
      }],
    })

    assert.equal(report.status, 'risk')
    assert.ok(report.score <= 70)
    assert.equal(report.riskCount, 1)
    assert.ok(report.checks.some((check) => check.code === 'startup_missing_tests'))
  })
})
