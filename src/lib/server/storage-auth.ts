import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import Database from 'better-sqlite3'

import { DATA_DIR, IS_BUILD_BOOTSTRAP } from './data-dir'
import { log } from '@/lib/server/logger'

const TAG = 'storage-auth'

// Fallback env file inside the data directory — survives Docker container restarts
// because DATA_DIR is volume-mounted, unlike process.cwd()/.env.local.
const GENERATED_ENV_PATH = path.join(DATA_DIR, '.env.generated')

// Dedicated single-purpose file for the credential-encryption secret. Lives in
// DATA_DIR so it survives both Docker volume mounts AND npm-global upgrades
// (the latter changes process.cwd() per version, which made .env.local-only
// persistence regenerate the secret every upgrade and orphan every credential
// encrypted under the old value).
const CREDENTIAL_SECRET_FILE = path.join(DATA_DIR, 'credential-secret')

// --- .env loading ---
type LoadedEnvFile = Record<string, string>
type CredentialSecretCandidate = {
  secret: string
  source: string
  mtimeMs: number
}

function loadEnvFile(filePath: string): LoadedEnvFile {
  const loaded: LoadedEnvFile = {}
  if (!fs.existsSync(filePath)) return loaded
  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach(line => {
    const [k, ...v] = line.split('=')
    if (k && v.length) loaded[k.trim()] = v.join('=').trim()
  })
  return loaded
}

function cleanSecret(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function applyLoadedEnv(loaded: LoadedEnvFile, externalKeys: Set<string>, options?: { overwriteLoaded?: boolean }) {
  for (const [key, value] of Object.entries(loaded)) {
    if (externalKeys.has(key)) continue
    if (options?.overwriteLoaded || process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value
    }
  }
}

function loadEnv(): { generated: LoadedEnvFile; local: LoadedEnvFile } {
  const externalKeys = new Set(
    Object.entries(process.env)
      .filter(([, value]) => typeof value === 'string' && value.length > 0)
      .map(([key]) => key),
  )
  const generated = loadEnvFile(GENERATED_ENV_PATH)
  const local = loadEnvFile(path.join(process.cwd(), '.env.local'))

  applyLoadedEnv(generated, externalKeys)
  applyLoadedEnv(local, externalKeys, { overwriteLoaded: true })
  return { generated, local }
}

function appendCandidate(candidates: CredentialSecretCandidate[], seen: Set<string>, candidate: CredentialSecretCandidate): void {
  const secret = cleanSecret(candidate.secret)
  if (!secret || seen.has(secret)) return
  seen.add(secret)
  candidates.push({ ...candidate, secret })
}

function readEnvCandidate(filePath: string, source: string): CredentialSecretCandidate | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const secret = cleanSecret(loadEnvFile(filePath).CREDENTIAL_SECRET)
    if (!secret) return null
    return {
      secret,
      source,
      mtimeMs: fs.statSync(filePath).mtimeMs,
    }
  } catch (err) {
    log.debug(TAG, `Could not inspect legacy CREDENTIAL_SECRET candidate at ${filePath}`, {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

function findStateHomeCandidates(): string[] {
  const homes: string[] = []
  const configuredHome = cleanSecret(process.env.SWARMCLAW_HOME)
  if (configuredHome) homes.push(path.resolve(configuredHome))
  if (path.basename(DATA_DIR) === 'data') homes.push(path.dirname(DATA_DIR))
  return Array.from(new Set(homes))
}

function collectPreviousBuildSecretCandidates(seen: Set<string>): CredentialSecretCandidate[] {
  const candidates: CredentialSecretCandidate[] = []
  for (const home of findStateHomeCandidates()) {
    const buildsDir = path.join(home, 'builds')
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(buildsDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('package-')) continue
      const buildRoot = path.join(buildsDir, entry.name)
      const envPaths = [
        path.join(buildRoot, '.env.local'),
        path.join(buildRoot, '.env.local.bak'),
        path.join(buildRoot, '.next', 'standalone', '.env.local'),
        path.join(buildRoot, '.next', 'standalone', '.env.local.bak'),
      ]
      for (const envPath of envPaths) {
        const candidate = readEnvCandidate(envPath, `previous build env ${envPath}`)
        if (candidate) appendCandidate(candidates, seen, candidate)
      }
    }
  }

  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function readEncryptedCredentialKeysFromObject(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  return Object.values(value as Record<string, unknown>)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return ''
      return cleanSecret((entry as Record<string, unknown>).encryptedKey)
    })
    .filter(Boolean)
}

function readEncryptedCredentialKeys(): string[] {
  const keys: string[] = []
  const jsonPath = path.join(DATA_DIR, 'credentials.json')
  try {
    if (fs.existsSync(jsonPath)) {
      keys.push(...readEncryptedCredentialKeysFromObject(JSON.parse(fs.readFileSync(jsonPath, 'utf8'))))
    }
  } catch (err) {
    log.debug(TAG, `Could not inspect encrypted credentials in ${jsonPath}`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const dbPath = path.join(DATA_DIR, 'swarmclaw.db')
  try {
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true })
      try {
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credentials'").get()
        if (table) {
          const rows = db.prepare('SELECT data FROM credentials LIMIT 500').all() as Array<{ data: string }>
          const fromDb: Record<string, unknown> = {}
          for (const [index, row] of rows.entries()) {
            try {
              fromDb[`row_${index}`] = JSON.parse(row.data)
            } catch {
              // Ignore malformed rows; storage normalization handles them later.
            }
          }
          keys.push(...readEncryptedCredentialKeysFromObject(fromDb))
        }
      } finally {
        db.close()
      }
    }
  } catch (err) {
    log.debug(TAG, `Could not inspect encrypted credentials in ${dbPath}`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return Array.from(new Set(keys))
}

function canDecryptCredential(encryptedKey: string, secret: string): boolean {
  try {
    const parts = encryptedKey.split(':')
    if (parts.length !== 3) return false
    const [ivHex, tagHex, encrypted] = parts
    const key = Buffer.from(secret, 'hex')
    if (key.length !== 32) return false
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    decipher.update(encrypted, 'hex', 'utf8')
    decipher.final('utf8')
    return true
  } catch {
    return false
  }
}

function countDecryptableCredentials(secret: string, encryptedKeys: string[]): number {
  if (encryptedKeys.length === 0) return 0
  return encryptedKeys.filter((encryptedKey) => canDecryptCredential(encryptedKey, secret)).length
}

function selectCredentialSecretCandidate(
  candidates: CredentialSecretCandidate[],
  encryptedKeys: string[],
): CredentialSecretCandidate | null {
  if (candidates.length === 0) return null
  if (encryptedKeys.length === 0) return candidates[0]

  let best: { candidate: CredentialSecretCandidate; count: number } | null = null
  for (const candidate of candidates) {
    const count = countDecryptableCredentials(candidate.secret, encryptedKeys)
    if (count === 0) continue
    if (!best || count > best.count) best = { candidate, count }
  }
  return best?.candidate ?? null
}
const externalCredentialSecret = process.env.CREDENTIAL_SECRET?.trim() || ''
const loadedEnv: { generated: LoadedEnvFile; local: LoadedEnvFile } = !IS_BUILD_BOOTSTRAP
  ? loadEnv()
  : { generated: {}, local: {} }

/** Append a key=value to a file only if the key doesn't already exist in it. */
function appendEnvKeyIfMissing(envPath: string, key: string, value: string): void {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const keyPattern = new RegExp(`^${key}=`, 'm')
  if (keyPattern.test(existing)) return
  fs.appendFileSync(envPath, `\n${key}=${value}\n`)
}

/** Try to persist a key to .env.local, falling back to DATA_DIR/.env.generated. */
function persistEnvKey(key: string, value: string): void {
  const envLocalPath = path.join(process.cwd(), '.env.local')
  // Try .env.local first (works for local dev, npm run dev)
  try {
    appendEnvKeyIfMissing(envLocalPath, key, value)
    return
  } catch {
    // .env.local not writable — expected in Docker containers
  }
  // Fall back to the data directory (volume-mounted in Docker)
  try {
    fs.mkdirSync(path.dirname(GENERATED_ENV_PATH), { recursive: true })
    appendEnvKeyIfMissing(GENERATED_ENV_PATH, key, value)
  } catch (err) {
    log.warn(TAG, `Could not persist ${key} to disk. It will be regenerated on restart.`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Read CREDENTIAL_SECRET from the dedicated file in DATA_DIR.
 *  Returns the trimmed contents, or empty string if absent / unreadable. */
function readCredentialSecretFile(): string {
  try {
    if (!fs.existsSync(CREDENTIAL_SECRET_FILE)) return ''
    return fs.readFileSync(CREDENTIAL_SECRET_FILE, 'utf-8').trim()
  } catch (err) {
    log.warn(TAG, `Could not read CREDENTIAL_SECRET from ${CREDENTIAL_SECRET_FILE}`, {
      error: err instanceof Error ? err.message : String(err),
    })
    return ''
  }
}

/** Write CREDENTIAL_SECRET to the dedicated file with restrictive permissions. */
function writeCredentialSecretFile(secret: string): boolean {
  try {
    fs.mkdirSync(path.dirname(CREDENTIAL_SECRET_FILE), { recursive: true })
    fs.writeFileSync(CREDENTIAL_SECRET_FILE, secret, { encoding: 'utf-8', mode: 0o600 })
    return true
  } catch (err) {
    log.warn(TAG, `Could not persist CREDENTIAL_SECRET to ${CREDENTIAL_SECRET_FILE}`, {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// Resolve CREDENTIAL_SECRET in this precedence order:
//   1. process.env (already set externally, e.g. by orchestrator)
//   2. DATA_DIR/credential-secret (the stable home — survives upgrades)
//   3. .env files (legacy current cwd plus prior npm-global build env files)
//   4. Generate new secret + persist to DATA_DIR/credential-secret
//
// Step 2 is the key change: previously the secret only lived in a per-version
// .env.local (cwd changes on npm-global upgrade), so each upgrade
// silently regenerated it and orphaned every encrypted credential. When
// encrypted credentials already exist, validate candidate legacy secrets by
// actually decrypting a stored credential before persisting the migration.
if (!IS_BUILD_BOOTSTRAP) {
  const encryptedCredentialKeys = readEncryptedCredentialKeys()
  const candidateSeen = new Set<string>()
  const legacyCandidates: CredentialSecretCandidate[] = []
  appendCandidate(legacyCandidates, candidateSeen, {
    secret: cleanSecret(loadedEnv.local.CREDENTIAL_SECRET),
    source: `${path.join(process.cwd(), '.env.local')}`,
    mtimeMs: 0,
  })
  appendCandidate(legacyCandidates, candidateSeen, {
    secret: cleanSecret(loadedEnv.generated.CREDENTIAL_SECRET),
    source: GENERATED_ENV_PATH,
    mtimeMs: 0,
  })
  legacyCandidates.push(...collectPreviousBuildSecretCandidates(candidateSeen))

  const legacyEnvSecret = legacyCandidates[0]?.secret || ''
  const fileSecret = readCredentialSecretFile()
  if (externalCredentialSecret) {
    process.env.CREDENTIAL_SECRET = externalCredentialSecret
    if (fileSecret && fileSecret !== externalCredentialSecret) {
      log.warn(TAG, `CREDENTIAL_SECRET is set by the environment and differs from ${CREDENTIAL_SECRET_FILE}; using the environment value.`)
    }
  } else if (fileSecret) {
    const fileDecryptsCredentials = encryptedCredentialKeys.length === 0
      || countDecryptableCredentials(fileSecret, encryptedCredentialKeys) > 0
    if (!fileDecryptsCredentials) {
      const recovered = selectCredentialSecretCandidate(
        legacyCandidates.filter((candidate) => candidate.secret !== fileSecret),
        encryptedCredentialKeys,
      )
      if (recovered) {
        process.env.CREDENTIAL_SECRET = recovered.secret
        writeCredentialSecretFile(recovered.secret)
        log.warn(TAG, `Recovered CREDENTIAL_SECRET from ${recovered.source} because ${CREDENTIAL_SECRET_FILE} could not decrypt existing credentials.`)
      } else {
        process.env.CREDENTIAL_SECRET = fileSecret
        log.warn(TAG, `${CREDENTIAL_SECRET_FILE} could not decrypt existing credentials, and no recoverable previous-build CREDENTIAL_SECRET was found.`)
      }
    } else {
      process.env.CREDENTIAL_SECRET = fileSecret
      if (legacyEnvSecret && legacyEnvSecret !== fileSecret) {
        // Both persisted locations exist and disagree. Trust DATA_DIR because it
        // survives npm-global upgrades and Docker restarts.
        log.warn(TAG, `CREDENTIAL_SECRET mismatch between legacy env files and ${CREDENTIAL_SECRET_FILE}; using the file value.`)
      }
    }
  } else {
    const recovered = selectCredentialSecretCandidate(legacyCandidates, encryptedCredentialKeys)
    if (recovered) {
      process.env.CREDENTIAL_SECRET = recovered.secret
      if (writeCredentialSecretFile(recovered.secret)) {
        log.info(TAG, `Migrated CREDENTIAL_SECRET from ${recovered.source} to ${CREDENTIAL_SECRET_FILE}`)
      }
    } else if (legacyEnvSecret) {
      process.env.CREDENTIAL_SECRET = legacyEnvSecret
      if (writeCredentialSecretFile(legacyEnvSecret)) {
        log.info(TAG, `Migrated CREDENTIAL_SECRET from .env to ${CREDENTIAL_SECRET_FILE}`)
      }
    } else {
      // First-ever launch on this DATA_DIR. Generate.
      const secret = crypto.randomBytes(32).toString('hex')
      process.env.CREDENTIAL_SECRET = secret
      writeCredentialSecretFile(secret)
      log.info(TAG, `Generated CREDENTIAL_SECRET and persisted to ${CREDENTIAL_SECRET_FILE}`)
    }
  }
}

// Auto-generate ACCESS_KEY if missing (used for simple auth)
const SETUP_FLAG = path.join(DATA_DIR, '.setup_pending')
if (!IS_BUILD_BOOTSTRAP && !process.env.ACCESS_KEY) {
  const key = crypto.randomBytes(16).toString('hex')
  process.env.ACCESS_KEY = key
  persistEnvKey('ACCESS_KEY', key)
  try { fs.writeFileSync(SETUP_FLAG, key) } catch { /* non-fatal */ }
  log.info(TAG, `ACCESS KEY: ${key} — Use this key to connect from the browser.`)
}

export function getAccessKey(): string {
  return process.env.ACCESS_KEY || ''
}

export function validateAccessKey(key: string): boolean {
  return key === process.env.ACCESS_KEY
}

export function isFirstTimeSetup(): boolean {
  return fs.existsSync(SETUP_FLAG)
}

export function markSetupComplete(): void {
  if (fs.existsSync(SETUP_FLAG)) fs.unlinkSync(SETUP_FLAG)
}

/** Replace the access key in memory and on disk (first-time setup override). */
export function replaceAccessKey(newKey: string): void {
  // Update in both possible locations
  for (const envPath of [path.join(process.cwd(), '.env.local'), GENERATED_ENV_PATH]) {
    try {
      if (fs.existsSync(envPath)) {
        const contents = fs.readFileSync(envPath, 'utf-8')
        if (/^ACCESS_KEY=/m.test(contents)) {
          fs.writeFileSync(envPath, contents.replace(/^ACCESS_KEY=.*$/m, `ACCESS_KEY=${newKey}`))
          continue
        }
      }
      appendEnvKeyIfMissing(envPath, 'ACCESS_KEY', newKey)
    } catch {
      // Not writable — try the other location
    }
  }
  process.env.ACCESS_KEY = newKey
}
