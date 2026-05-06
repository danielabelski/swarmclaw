import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { buildAttachments } from './email'
import { connectorSupportsBinaryMedia } from './response-media'

describe('connectorSupportsBinaryMedia — email', () => {
  it('marks email as supporting outbound binary media', () => {
    assert.equal(connectorSupportsBinaryMedia('email'), true)
  })

  it('still returns false for platforms that do not support outbound binary', () => {
    assert.equal(connectorSupportsBinaryMedia('signal'), false)
    assert.equal(connectorSupportsBinaryMedia('matrix'), false)
    assert.equal(connectorSupportsBinaryMedia('filequeue'), false)
  })
})

describe('email buildAttachments', () => {
  it('returns an empty array when no mediaPath is set', () => {
    assert.deepEqual(buildAttachments(), [])
    assert.deepEqual(buildAttachments({}), [])
  })

  it('returns an empty array when mediaPath points at a missing file', () => {
    const missing = path.join(os.tmpdir(), `swarmclaw-email-missing-${Date.now()}.bin`)
    assert.equal(fs.existsSync(missing), false)
    assert.deepEqual(buildAttachments({ mediaPath: missing }), [])
  })

  it('builds a single attachment entry from mediaPath, defaulting the filename to basename', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-email-test-'))
    const file = path.join(dir, 'report.pdf')
    fs.writeFileSync(file, '%PDF-1.4 test')
    try {
      const attachments = buildAttachments({ mediaPath: file })
      assert.equal(attachments.length, 1)
      assert.equal(attachments[0].path, file)
      assert.equal(attachments[0].filename, 'report.pdf')
      assert.equal(attachments[0].contentType, undefined)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('respects explicit fileName and mimeType when provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-email-test-'))
    const file = path.join(dir, 'raw.bin')
    fs.writeFileSync(file, 'x')
    try {
      const attachments = buildAttachments({
        mediaPath: file,
        fileName: 'quarterly-report.pdf',
        mimeType: 'application/pdf',
      })
      assert.equal(attachments.length, 1)
      assert.equal(attachments[0].filename, 'quarterly-report.pdf')
      assert.equal(attachments[0].contentType, 'application/pdf')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
