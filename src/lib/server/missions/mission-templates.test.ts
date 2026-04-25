import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const originalEnv = {
  DATA_DIR: process.env.DATA_DIR,
  WORKSPACE_DIR: process.env.WORKSPACE_DIR,
  SWARMCLAW_BUILD_MODE: process.env.SWARMCLAW_BUILD_MODE,
}

let tempDir = ''
let templates: typeof import('./mission-templates')
let service: typeof import('./mission-service')

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-mission-tpl-'))
  process.env.DATA_DIR = path.join(tempDir, 'data')
  process.env.WORKSPACE_DIR = path.join(tempDir, 'workspace')
  process.env.SWARMCLAW_BUILD_MODE = '1'
  templates = await import('./mission-templates')
  service = await import('./mission-service')
})

after(() => {
  if (originalEnv.DATA_DIR === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = originalEnv.DATA_DIR
  if (originalEnv.WORKSPACE_DIR === undefined) delete process.env.WORKSPACE_DIR
  else process.env.WORKSPACE_DIR = originalEnv.WORKSPACE_DIR
  if (originalEnv.SWARMCLAW_BUILD_MODE === undefined) delete process.env.SWARMCLAW_BUILD_MODE
  else process.env.SWARMCLAW_BUILD_MODE = originalEnv.SWARMCLAW_BUILD_MODE
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('mission-templates: registry', () => {
  it('ships at least 6 built-in templates', () => {
    const list = templates.listMissionTemplates()
    assert.ok(list.length >= 6, `expected 6+ templates, got ${list.length}`)
  })

  it('has no duplicate template ids', () => {
    const list = templates.listMissionTemplates()
    const ids = new Set<string>()
    for (const t of list) {
      assert.ok(!ids.has(t.id), `duplicate template id: ${t.id}`)
      ids.add(t.id)
    }
  })

  it('every template has required fields populated', () => {
    const list = templates.listMissionTemplates()
    for (const t of list) {
      assert.ok(t.id, `missing id`)
      assert.ok(t.name, `${t.id} missing name`)
      assert.ok(t.description, `${t.id} missing description`)
      assert.ok(t.icon, `${t.id} missing icon`)
      assert.ok(t.category, `${t.id} missing category`)
      assert.ok(Array.isArray(t.tags), `${t.id} tags not array`)
      assert.ok(t.defaults.title, `${t.id} missing defaults.title`)
      assert.ok(t.defaults.goal, `${t.id} missing defaults.goal`)
      assert.ok(Array.isArray(t.defaults.successCriteria), `${t.id} successCriteria not array`)
      assert.ok(t.defaults.budget, `${t.id} missing budget`)
      assert.ok(Array.isArray(t.defaults.budget.warnAtFractions), `${t.id} budget.warnAtFractions missing`)
    }
  })

  it('includes the launch week growth sprint template', () => {
    const template = templates.getMissionTemplate('launch-week-growth-sprint')
    assert.ok(template, 'expected launch sprint template')
    assert.equal(template.name, 'Launch Week Growth Sprint')
    assert.equal(template.category, 'productivity')
    assert.ok(template.defaults.goal.includes('Do not post publicly without explicit approval'))
    assert.ok(template.defaults.successCriteria.some((item) => item.includes('Product Hunt')))
  })

  it('includes operator quality release templates', () => {
    const expected = [
      'release-candidate-qa',
      'agent-cost-audit',
      'connector-smoke-test',
      'failed-run-triage',
      'weekly-agent-quality-report',
    ]

    for (const id of expected) {
      const template = templates.getMissionTemplate(id)
      assert.ok(template, `expected ${id} template`)
      assert.ok(template.tags.includes('quality') || template.tags.includes('operator-quality'), `${id} should be quality tagged`)
      assert.ok(template.defaults.goal.includes('approval') || template.defaults.goal.includes('evidence'), `${id} should preserve operator guardrails`)
      assert.ok(template.defaults.budget.maxWallclockSec, `${id} should have a wallclock cap`)
      assert.ok(template.defaults.reportSchedule, `${id} should schedule reports`)
    }

    assert.equal(templates.getMissionTemplate('release-candidate-qa')?.name, 'Release Candidate QA')
    assert.equal(templates.getMissionTemplate('weekly-agent-quality-report')?.category, 'monitoring')
  })

  it('getMissionTemplate resolves known ids', () => {
    const list = templates.listMissionTemplates()
    const first = list[0]
    const resolved = templates.getMissionTemplate(first.id)
    assert.equal(resolved?.id, first.id)
  })

  it('getMissionTemplate returns null for unknown ids', () => {
    assert.equal(templates.getMissionTemplate('nope-does-not-exist'), null)
    assert.equal(templates.getMissionTemplate(''), null)
    assert.equal(templates.getMissionTemplate(null), null)
    assert.equal(templates.getMissionTemplate(undefined), null)
  })
})

describe('mission-service: createMissionFromTemplate', () => {
  it('materializes a mission using template defaults', () => {
    const list = templates.listMissionTemplates()
    const tpl = list[0]
    const result = service.createMissionFromTemplate({
      templateId: tpl.id,
      rootSessionId: 'sess_test_1',
    })
    assert.ok(result, 'expected result')
    assert.equal(result!.mission.templateId, tpl.id)
    assert.equal(result!.mission.goal, tpl.defaults.goal)
    assert.equal(result!.mission.title, tpl.defaults.title)
    assert.equal(result!.mission.rootSessionId, 'sess_test_1')
    assert.deepEqual(result!.mission.successCriteria, tpl.defaults.successCriteria)
    assert.equal(result!.template.id, tpl.id)
  })

  it('applies overrides without dropping unspecified defaults', () => {
    const tpl = templates.listMissionTemplates()[0]
    const result = service.createMissionFromTemplate({
      templateId: tpl.id,
      rootSessionId: 'sess_test_2',
      overrides: {
        title: 'Custom title',
        budget: { maxUsd: 99 },
      },
    })
    assert.ok(result)
    assert.equal(result!.mission.title, 'Custom title')
    assert.equal(result!.mission.budget.maxUsd, 99)
    // Token cap from template should persist when not overridden
    assert.equal(result!.mission.budget.maxTokens, tpl.defaults.budget.maxTokens)
    // Goal unchanged
    assert.equal(result!.mission.goal, tpl.defaults.goal)
  })

  it('returns null for unknown template id', () => {
    const result = service.createMissionFromTemplate({
      templateId: 'no-such-template',
      rootSessionId: 'sess_test_3',
    })
    assert.equal(result, null)
  })

  it('allows overriding reportSchedule to null', () => {
    const tpl = templates.listMissionTemplates()[0]
    const result = service.createMissionFromTemplate({
      templateId: tpl.id,
      rootSessionId: 'sess_test_4',
      overrides: { reportSchedule: null },
    })
    assert.ok(result)
    assert.equal(result!.mission.reportSchedule, null)
  })
})

describe('mission-service: templateId persistence', () => {
  it('createMission persists an explicit templateId', () => {
    const mission = service.createMission({
      title: 'Direct',
      goal: 'no template',
      rootSessionId: 'sess_direct',
      templateId: 'some-template-id',
    })
    assert.equal(mission.templateId, 'some-template-id')
  })

  it('createMission defaults templateId to null when omitted', () => {
    const mission = service.createMission({
      title: 'Direct',
      goal: 'no template',
      rootSessionId: 'sess_direct_2',
    })
    assert.equal(mission.templateId, null)
  })
})

// Normalization test: legacy mission JSON without templateId should get templateId: null after load.
describe('mission normalization: templateId default', () => {
  const loadItem = () => null

  it('legacy records normalize to templateId: null', async () => {
    const { normalizeStoredRecord } = await import('@/lib/server/storage-normalization')
    const legacy: Record<string, unknown> = {
      id: 'mi_legacy_1',
      title: 'Legacy',
      goal: 'from before templates',
      successCriteria: [],
      rootSessionId: 'sess_legacy',
      agentIds: [],
      status: 'draft',
      budget: {},
      usage: {},
      milestones: [],
      reportConnectorIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const { value } = normalizeStoredRecord('agent_missions', legacy, loadItem)
    const normalized = value as { templateId: unknown }
    assert.equal(normalized.templateId, null)
  })

  it('normalization preserves a valid templateId', async () => {
    const { normalizeStoredRecord } = await import('@/lib/server/storage-normalization')
    const record: Record<string, unknown> = {
      id: 'mi_tpl_1',
      title: 'From template',
      goal: 'x',
      successCriteria: [],
      rootSessionId: 'sess_tpl',
      agentIds: [],
      status: 'draft',
      budget: {},
      usage: {},
      milestones: [],
      reportConnectorIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      templateId: 'daily-news-digest',
    }
    const { value } = normalizeStoredRecord('agent_missions', record, loadItem)
    const normalized = value as { templateId: unknown }
    assert.equal(normalized.templateId, 'daily-news-digest')
  })
})
