import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveDreamGenerationPreference } from './dream-generation-preference'
import { parseTier2DreamResponseText } from './dream-service'

describe('resolveDreamGenerationPreference', () => {
  it('returns no preference when no dream provider is configured', () => {
    assert.equal(resolveDreamGenerationPreference({}), undefined)
    assert.equal(resolveDreamGenerationPreference({ dreamProvider: '   ' }), undefined)
  })

  it('builds a trimmed dream model preference from app settings', () => {
    assert.deepEqual(resolveDreamGenerationPreference({
      dreamProvider: ' ollama ',
      dreamModel: ' gemma4:e4b ',
      dreamCredentialId: ' cred-1 ',
      dreamEndpoint: ' http://localhost:11434 ',
    }), {
      provider: 'ollama',
      model: 'gemma4:e4b',
      credentialId: 'cred-1',
      apiEndpoint: 'http://localhost:11434',
    })
  })
})

describe('parseTier2DreamResponseText', () => {
  it('parses a plain structured dream response', () => {
    const parsed = parseTier2DreamResponseText(JSON.stringify({
      consolidations: [{
        sourceIds: ['mem-1', 'mem-2'],
        title: 'Shared pattern',
        content: 'Both memories describe the same workflow.',
      }],
      reflections: [{ title: 'Focus', content: 'The agent prefers short release loops.' }],
      flagged: [{ memoryId: 'mem-3', reason: 'Contradicts the current release process.' }],
    }))

    assert.deepEqual(parsed?.consolidations?.[0]?.sourceIds, ['mem-1', 'mem-2'])
    assert.equal(parsed?.reflections?.[0]?.title, 'Focus')
    assert.equal(parsed?.flagged?.[0]?.memoryId, 'mem-3')
  })

  it('extracts fenced JSON with nested braces inside strings', () => {
    const parsed = parseTier2DreamResponseText([
      '```json',
      '{',
      '  "consolidations": [{',
      '    "sourceIds": ["mem-1"],',
      '    "title": "Payload shape",',
      '    "content": "The JSON example was {\\"ok\\":true} and should stay intact."',
      '  }]',
      '}',
      '```',
    ].join('\n'))

    assert.equal(parsed?.consolidations?.[0]?.content, 'The JSON example was {"ok":true} and should stay intact.')
  })

  it('rejects malformed or schema-incompatible responses', () => {
    assert.equal(parseTier2DreamResponseText('no json here'), null)
    assert.equal(parseTier2DreamResponseText('{"consolidations":[{"sourceIds":[123],"title":"Bad","content":"Bad"}]}'), null)
  })
})
