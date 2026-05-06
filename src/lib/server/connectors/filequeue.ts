import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { genId } from '@/lib/id'
import { CONNECTORS_DATA_DIR } from '@/lib/server/data-dir'
import { log } from '@/lib/server/logger'
import { errorMessage } from '@/lib/shared-utils'
import type { Connector } from '@/types'
import type {
  ConnectorIngressResult,
  ConnectorInstance,
  InboundMessage,
  OutboundSendOptions,
  PlatformConnector,
} from './types'
import { resolveConnectorIngressReply } from './ingress-delivery'

const TAG = 'filequeue'
const DEFAULT_POLL_INTERVAL_MS = 1_000
const MIN_POLL_INTERVAL_MS = 250

export interface FileQueuePaths {
  rootDir: string
  inboxDir: string
  outboxDir: string
  archiveDir: string
  errorDir: string
}

export interface FileQueueDrainResult {
  processed: number
  failed: number
}

export interface FileQueueOutboundInput {
  channelId: string
  text: string
  threadId?: string
  replyToMessageId?: string
  options?: OutboundSendOptions
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function expandHome(input: string): string {
  if (input === '~') return os.homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2))
  }
  return input
}

function resolveConfiguredPath(rootDir: string, configured: unknown, fallback: string): string {
  const value = clean(configured)
  if (!value) return path.join(rootDir, fallback)
  const expanded = expandHome(value)
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(rootDir, expanded)
}

function parsePollIntervalMs(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() ? Number.parseInt(value.trim(), 10) : DEFAULT_POLL_INTERVAL_MS)
  if (!Number.isFinite(parsed)) return DEFAULT_POLL_INTERVAL_MS
  return Math.max(MIN_POLL_INTERVAL_MS, parsed)
}

function ensureFileQueueDirs(paths: FileQueuePaths): void {
  for (const dir of [paths.rootDir, paths.inboxDir, paths.outboxDir, paths.archiveDir, paths.errorDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function resolveFileQueuePaths(connector: Connector): FileQueuePaths {
  const config = connector.config || {}
  const configuredRoot = clean(config.rootDir)
  const rootDir = configuredRoot
    ? path.resolve(expandHome(configuredRoot))
    : path.join(CONNECTORS_DATA_DIR, connector.id, 'filequeue')
  return {
    rootDir,
    inboxDir: resolveConfiguredPath(rootDir, config.inboxDir, 'inbox'),
    outboxDir: resolveConfiguredPath(rootDir, config.outboxDir, 'outbox'),
    archiveDir: resolveConfiguredPath(rootDir, config.archiveDir, 'archive'),
    errorDir: resolveConfiguredPath(rootDir, config.errorDir, 'errors'),
  }
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = clean(value)
    if (text) return text
  }
  return ''
}

function fileNameSafe(value: string): string {
  return value
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0)
      const isDigit = code >= 48 && code <= 57
      const isUpper = code >= 65 && code <= 90
      const isLower = code >= 97 && code <= 122
      return isDigit || isUpper || isLower || char === '-' || char === '_' ? char : '_'
    })
    .join('')
    .slice(0, 96) || 'item'
}

function resolveUniquePath(dir: string, basename: string): string {
  const ext = path.extname(basename)
  const stem = path.basename(basename, ext)
  let candidate = path.join(dir, basename)
  if (!fs.existsSync(candidate)) return candidate
  for (let i = 1; i < 1_000; i += 1) {
    candidate = path.join(dir, `${stem}-${i}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  return path.join(dir, `${stem}-${Date.now()}-${genId()}${ext}`)
}

async function moveFile(source: string, targetDir: string): Promise<string> {
  await fsp.mkdir(targetDir, { recursive: true })
  const target = resolveUniquePath(targetDir, path.basename(source))
  try {
    await fsp.rename(source, target)
  } catch (err: unknown) {
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : ''
    if (code !== 'EXDEV') throw err
    await fsp.copyFile(source, target)
    await fsp.unlink(source)
  }
  return target
}

function readNestedEnvelope(record: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(record.payload)
    || asRecord(record.command)
    || asRecord(record.message)
    || asRecord(record.data)
}

export function normalizeFileQueueEnvelope(connector: Connector, envelope: unknown): InboundMessage {
  const record = asRecord(envelope)
  if (!record) throw new Error('File queue envelope must be a JSON object')
  const nested = readNestedEnvelope(record)
  const sender = asRecord(record.sender) || asRecord(nested?.sender)
  const config = connector.config || {}
  const id = firstText(record.id, record.messageId, record.commandId, nested?.id, nested?.messageId, genId())
  const text = firstText(
    record.text,
    record.body,
    record.prompt,
    typeof record.command === 'string' ? record.command : '',
    nested?.text,
    nested?.body,
    nested?.prompt,
    typeof nested?.command === 'string' ? nested.command : '',
  )
  if (!text) throw new Error('File queue envelope requires text, body, prompt, or command')

  const channelId = firstText(record.channelId, record.channel, nested?.channelId, nested?.channel, config.defaultChannelId, 'filequeue')
  const senderId = firstText(record.senderId, sender?.id, sender?.senderId, nested?.senderId, config.defaultSenderId, 'filequeue')
  const senderName = firstText(record.senderName, sender?.name, sender?.senderName, nested?.senderName, config.defaultSenderName, senderId)

  return {
    platform: 'filequeue',
    channelId,
    channelName: firstText(record.channelName, nested?.channelName, channelId),
    senderId,
    senderName,
    text,
    messageId: id,
    replyToMessageId: firstText(record.replyToMessageId, nested?.replyToMessageId) || undefined,
    threadId: firstText(record.threadId, nested?.threadId) || undefined,
    isGroup: record.isGroup === true || nested?.isGroup === true,
  }
}

export async function writeFileQueueOutbound(
  connector: Connector,
  input: FileQueueOutboundInput,
): Promise<{ id: string; path: string; payload: Record<string, unknown> }> {
  const paths = resolveFileQueuePaths(connector)
  ensureFileQueueDirs(paths)
  const id = genId()
  const payload: Record<string, unknown> = {
    id,
    kind: 'swarmclaw.filequeue.outbound',
    connectorId: connector.id,
    connectorName: connector.name,
    platform: 'filequeue',
    channelId: input.channelId,
    text: input.text,
    createdAt: new Date().toISOString(),
  }
  if (input.threadId) payload.threadId = input.threadId
  if (input.replyToMessageId) payload.replyToMessageId = input.replyToMessageId
  if (input.options?.imageUrl) payload.imageUrl = input.options.imageUrl
  if (input.options?.fileUrl) payload.fileUrl = input.options.fileUrl
  if (input.options?.mediaPath) payload.mediaPath = input.options.mediaPath
  if (input.options?.mimeType) payload.mimeType = input.options.mimeType
  if (input.options?.fileName) payload.fileName = input.options.fileName
  if (input.options?.caption) payload.caption = input.options.caption

  const filename = `${Date.now()}-${fileNameSafe(id)}.json`
  const outputPath = resolveUniquePath(paths.outboxDir, filename)
  await fsp.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return { id, path: outputPath, payload }
}

export async function drainFileQueueOnce(
  connector: Connector,
  onMessage: (msg: InboundMessage) => Promise<ConnectorIngressResult>,
): Promise<FileQueueDrainResult> {
  const paths = resolveFileQueuePaths(connector)
  ensureFileQueueDirs(paths)
  const entries = await fsp.readdir(paths.inboxDir, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  let processed = 0
  let failed = 0

  for (const file of files) {
    const source = path.join(paths.inboxDir, file)
    try {
      const raw = await fsp.readFile(source, 'utf8')
      const envelope = JSON.parse(raw) as unknown
      const inbound = normalizeFileQueueEnvelope(connector, envelope)
      const reply = await resolveConnectorIngressReply(onMessage, inbound)
      if (reply) {
        await writeFileQueueOutbound(connector, {
          channelId: inbound.channelId,
          text: reply.visibleText,
          threadId: inbound.threadId,
          replyToMessageId: inbound.messageId,
        })
      }
      await moveFile(source, paths.archiveDir)
      processed += 1
    } catch (err: unknown) {
      failed += 1
      const message = errorMessage(err)
      log.warn(TAG, `Failed to process file queue command ${file}: ${message}`)
      try {
        const moved = fs.existsSync(source)
          ? await moveFile(source, paths.errorDir)
          : path.join(paths.errorDir, file)
        await fsp.writeFile(`${moved}.error.txt`, `${message}\n`, 'utf8')
      } catch (moveErr: unknown) {
        log.warn(TAG, `Failed to move malformed file queue command ${file}: ${errorMessage(moveErr)}`)
      }
    }
  }

  return { processed, failed }
}

const fileQueue: PlatformConnector = {
  async start(connector, _botToken, onMessage): Promise<ConnectorInstance> {
    const paths = resolveFileQueuePaths(connector)
    ensureFileQueueDirs(paths)
    let stopped = false
    let draining = false
    const pollIntervalMs = parsePollIntervalMs(connector.config?.pollIntervalMs)

    const drain = async () => {
      if (stopped || draining) return
      draining = true
      try {
        const result = await drainFileQueueOnce(connector, onMessage)
        if (result.processed || result.failed) {
          log.info(TAG, `File queue drain for ${connector.name}: ${result.processed} processed, ${result.failed} failed`)
        }
      } catch (err: unknown) {
        log.warn(TAG, `File queue drain failed for ${connector.name}: ${errorMessage(err)}`)
      } finally {
        draining = false
      }
    }

    void drain()
    const timer = setInterval(() => {
      void drain()
    }, pollIntervalMs)
    timer.unref?.()

    return {
      connector,
      authenticated: true,
      supportsBinaryMedia: false,
      stop: async () => {
        stopped = true
        clearInterval(timer)
      },
      isAlive: () => !stopped,
      sendMessage: async (channelId: string, text: string, options?: OutboundSendOptions) => {
        const written = await writeFileQueueOutbound(connector, {
          channelId,
          text,
          threadId: options?.threadId,
          replyToMessageId: options?.replyToMessageId,
          options,
        })
        return { messageId: written.id }
      },
    }
  },
}

export default fileQueue
