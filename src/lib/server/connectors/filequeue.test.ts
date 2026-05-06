import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { Connector } from '@/types'
import {
  drainFileQueueOnce,
  normalizeFileQueueEnvelope,
  resolveFileQueuePaths,
  writeFileQueueOutbound,
} from './filequeue'

function makeConnector(rootDir: string): Connector {
  return {
    id: 'filequeue-1',
    name: 'Local Queue',
    platform: 'filequeue',
    agentId: 'agent-1',
    chatroomId: null,
    credentialId: null,
    config: {
      rootDir,
      defaultSenderId: 'queue',
      defaultSenderName: 'Queue',
      defaultChannelId: 'ops',
    },
    isEnabled: true,
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
  }
}

test('normalizeFileQueueEnvelope maps command JSON into an inbound connector message', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-filequeue-'))
  try {
    const connector = makeConnector(rootDir)
    const inbound = normalizeFileQueueEnvelope(connector, {
      id: 'cmd-1',
      channelId: 'ops',
      senderId: 'jarvis',
      senderName: 'JARVIS',
      text: 'Summarize current status',
      threadId: 'status-thread',
    })

    assert.equal(inbound.platform, 'filequeue')
    assert.equal(inbound.channelId, 'ops')
    assert.equal(inbound.senderId, 'jarvis')
    assert.equal(inbound.senderName, 'JARVIS')
    assert.equal(inbound.messageId, 'cmd-1')
    assert.equal(inbound.threadId, 'status-thread')
    assert.equal(inbound.text, 'Summarize current status')
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
})

test('drainFileQueueOnce archives processed commands and writes replies to outbox', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-filequeue-'))
  try {
    const connector = makeConnector(rootDir)
    const paths = resolveFileQueuePaths(connector)
    fs.mkdirSync(paths.inboxDir, { recursive: true })
    fs.writeFileSync(path.join(paths.inboxDir, '001.json'), JSON.stringify({
      id: 'cmd-1',
      senderId: 'jarvis',
      senderName: 'JARVIS',
      text: 'Run the release check',
    }))

    const result = await drainFileQueueOnce(connector, async (msg) => {
      assert.equal(msg.channelId, 'ops')
      assert.equal(msg.senderId, 'jarvis')
      assert.equal(msg.text, 'Run the release check')
      return 'Release check queued.'
    })

    assert.equal(result.processed, 1)
    assert.equal(result.failed, 0)
    assert.equal(fs.existsSync(path.join(paths.inboxDir, '001.json')), false)
    assert.equal(fs.existsSync(path.join(paths.archiveDir, '001.json')), true)

    const outboxFiles = fs.readdirSync(paths.outboxDir).filter((file) => file.endsWith('.json'))
    assert.equal(outboxFiles.length, 1)
    const outbound = JSON.parse(fs.readFileSync(path.join(paths.outboxDir, outboxFiles[0]), 'utf8')) as Record<string, unknown>
    assert.equal(outbound.connectorId, connector.id)
    assert.equal(outbound.channelId, 'ops')
    assert.equal(outbound.text, 'Release check queued.')
    assert.equal(outbound.replyToMessageId, 'cmd-1')
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
})

test('drainFileQueueOnce moves malformed JSON into the error directory', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-filequeue-'))
  try {
    const connector = makeConnector(rootDir)
    const paths = resolveFileQueuePaths(connector)
    fs.mkdirSync(paths.inboxDir, { recursive: true })
    fs.writeFileSync(path.join(paths.inboxDir, 'broken.json'), '{bad-json')

    const result = await drainFileQueueOnce(connector, async () => {
      throw new Error('should not route malformed envelopes')
    })

    assert.equal(result.processed, 0)
    assert.equal(result.failed, 1)
    assert.equal(fs.existsSync(path.join(paths.inboxDir, 'broken.json')), false)
    assert.equal(fs.existsSync(path.join(paths.errorDir, 'broken.json')), true)
    assert.equal(fs.existsSync(path.join(paths.errorDir, 'broken.json.error.txt')), true)
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
})

test('writeFileQueueOutbound stores structured command output in the outbox', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-filequeue-'))
  try {
    const connector = makeConnector(rootDir)
    const written = await writeFileQueueOutbound(connector, {
      channelId: 'ops',
      text: 'Done',
      threadId: 'status-thread',
      replyToMessageId: 'cmd-1',
    })

    const payload = JSON.parse(fs.readFileSync(written.path, 'utf8')) as Record<string, unknown>
    assert.equal(payload.kind, 'swarmclaw.filequeue.outbound')
    assert.equal(payload.connectorId, connector.id)
    assert.equal(payload.channelId, 'ops')
    assert.equal(payload.text, 'Done')
    assert.equal(payload.threadId, 'status-thread')
    assert.equal(payload.replyToMessageId, 'cmd-1')
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
})
