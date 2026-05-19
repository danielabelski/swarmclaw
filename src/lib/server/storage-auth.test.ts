import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')

function runStorageAuthImport(options: {
  envLocal?: string
  generatedEnv?: string
  credentialSecretFile?: string
  externalCredentialSecret?: string
  swarmclawHome?: boolean
  buildEnvFiles?: Array<{ relativePath: string; content: string }>
  encryptedCredentialSecrets?: string[]
}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-auth-import-'))
  const homeDir = path.join(tmpDir, 'home')
  const dataDir = options.swarmclawHome ? path.join(homeDir, 'data') : path.join(tmpDir, 'data')
  const cwd = options.swarmclawHome
    ? path.join(homeDir, 'builds', 'package-current', '.next', 'standalone')
    : path.join(tmpDir, 'cwd')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(cwd, { recursive: true })
  try {
    for (const [index, entry] of (options.buildEnvFiles ?? []).entries()) {
      const target = path.join(homeDir, entry.relativePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, entry.content, 'utf8')
      const time = new Date(Date.now() - (options.buildEnvFiles!.length - index) * 1000)
      fs.utimesSync(target, time, time)
    }
    if (options.envLocal !== undefined) {
      fs.writeFileSync(path.join(cwd, '.env.local'), options.envLocal, 'utf8')
    }
    if (options.generatedEnv !== undefined) {
      fs.writeFileSync(path.join(dataDir, '.env.generated'), options.generatedEnv, 'utf8')
    }
    if (options.credentialSecretFile !== undefined) {
      fs.writeFileSync(path.join(dataDir, 'credential-secret'), options.credentialSecretFile, { encoding: 'utf8', mode: 0o600 })
    }
    if (options.encryptedCredentialSecrets?.length) {
      const db = new Database(path.join(dataDir, 'swarmclaw.db'))
      try {
        db.exec('CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        for (const [index, secret] of options.encryptedCredentialSecrets.entries()) {
          const id = `cred_${index}`
          const encryptedKey = encryptForSecret(secret, `token-${index}`)
          db.prepare('INSERT OR REPLACE INTO credentials (id, data) VALUES (?, ?)').run(id, JSON.stringify({
            id,
            provider: 'slack',
            name: `Credential ${index}`,
            encryptedKey,
            createdAt: Date.now(),
          }))
        }
      } finally {
        db.close()
      }
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATA_DIR: dataDir,
      WORKSPACE_DIR: path.join(tmpDir, 'workspace'),
      SWARMCLAW_DAEMON_AUTOSTART: '0',
    }
    if (options.swarmclawHome) env.SWARMCLAW_HOME = homeDir
    delete env.ACCESS_KEY
    delete env.CREDENTIAL_SECRET
    delete env.SWARMCLAW_BUILD_MODE
    if (options.externalCredentialSecret !== undefined) {
      env.CREDENTIAL_SECRET = options.externalCredentialSecret
    }
    const script = `
      import fs from 'node:fs'
      import path from 'node:path'
      import { pathToFileURL } from 'node:url'
      process.chdir(${JSON.stringify(cwd)})
      await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'src/lib/server/storage-auth.ts'))}).href)
      const secretPath = path.join(process.env.DATA_DIR, 'credential-secret')
      const fileSecret = fs.existsSync(secretPath) ? fs.readFileSync(secretPath, 'utf8').trim() : ''
      const mode = fs.existsSync(secretPath) ? (fs.statSync(secretPath).mode & 0o777).toString(8) : ''
      console.log(JSON.stringify({
        credentialSecret: process.env.CREDENTIAL_SECRET || '',
        fileSecret,
        mode,
      }))
    `
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
      timeout: 15_000,
    })
    assert.equal(result.status, 0, result.stderr || result.stdout || 'storage-auth subprocess failed')
    const jsonLine = (result.stdout || '').trim().split('\n').reverse().find((line) => line.trim().startsWith('{'))
    return JSON.parse(jsonLine || '{}') as { credentialSecret: string; fileSecret: string; mode: string }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

function encryptForSecret(secret: string, plaintext: string): string {
  const key = Buffer.from(secret, 'hex')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${tag}:${encrypted}`
}

/**
 * Tests for storage-auth helpers.
 *
 * We can't import the module directly (it has side-effects that touch the real
 * filesystem), so we test the key parsing and persistence logic in isolation
 * by reimplementing the pure functions and verifying the patterns they use.
 */

// Replicate the env-file parser from storage-auth.ts
function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {}
  content.split(/\r?\n/).forEach((line) => {
    const [k, ...v] = line.split('=')
    if (k && v.length) vars[k.trim()] = v.join('=').trim()
  })
  return vars
}

// Replicate appendEnvKeyIfMissing from storage-auth.ts
function appendEnvKeyIfMissing(envPath: string, key: string, value: string): void {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const keyPattern = new RegExp(`^${key}=`, 'm')
  if (keyPattern.test(existing)) return
  fs.appendFileSync(envPath, `\n${key}=${value}\n`)
}

describe('env file parsing', () => {
  it('parses Unix line endings', () => {
    const vars = parseEnvFile('ACCESS_KEY=abc123\nCREDENTIAL_SECRET=secret456\n')
    assert.equal(vars.ACCESS_KEY, 'abc123')
    assert.equal(vars.CREDENTIAL_SECRET, 'secret456')
  })

  it('parses Windows line endings without trailing \\r', () => {
    const vars = parseEnvFile('ACCESS_KEY=abc123\r\nCREDENTIAL_SECRET=secret456\r\n')
    assert.equal(vars.ACCESS_KEY, 'abc123')
    assert.equal(vars.CREDENTIAL_SECRET, 'secret456')
    // Verify no \r is left on the values
    assert.ok(!vars.ACCESS_KEY.includes('\r'), 'ACCESS_KEY should not contain \\r')
    assert.ok(!vars.CREDENTIAL_SECRET.includes('\r'), 'CREDENTIAL_SECRET should not contain \\r')
  })

  it('handles mixed line endings', () => {
    const vars = parseEnvFile('A=1\r\nB=2\nC=3\r\n')
    assert.equal(vars.A, '1')
    assert.equal(vars.B, '2')
    assert.equal(vars.C, '3')
  })

  it('preserves values containing equals signs', () => {
    const vars = parseEnvFile('SECRET=abc=def=ghi\n')
    assert.equal(vars.SECRET, 'abc=def=ghi')
  })

  it('skips empty lines and comment-like lines without =', () => {
    const vars = parseEnvFile('\n# comment line\nKEY=val\n\n')
    assert.equal(Object.keys(vars).length, 1)
    assert.equal(vars.KEY, 'val')
  })

  it('trims whitespace from keys and values', () => {
    const vars = parseEnvFile('  MY_KEY  =  my_value  \n')
    assert.equal(vars.MY_KEY, 'my_value')
  })
})

describe('appendEnvKeyIfMissing', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-auth-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('appends key to empty file', () => {
    const envPath = path.join(tmpDir, '.env.local')
    fs.writeFileSync(envPath, '', 'utf8')
    appendEnvKeyIfMissing(envPath, 'ACCESS_KEY', 'test123')
    const content = fs.readFileSync(envPath, 'utf8')
    assert.ok(content.includes('ACCESS_KEY=test123'))
  })

  it('creates file if it does not exist', () => {
    const envPath = path.join(tmpDir, '.env.local')
    appendEnvKeyIfMissing(envPath, 'ACCESS_KEY', 'test123')
    assert.ok(fs.existsSync(envPath))
    const content = fs.readFileSync(envPath, 'utf8')
    assert.ok(content.includes('ACCESS_KEY=test123'))
  })

  it('does not duplicate an existing key', () => {
    const envPath = path.join(tmpDir, '.env.local')
    fs.writeFileSync(envPath, 'ACCESS_KEY=original\n', 'utf8')
    appendEnvKeyIfMissing(envPath, 'ACCESS_KEY', 'should-not-appear')
    const content = fs.readFileSync(envPath, 'utf8')
    assert.equal(content, 'ACCESS_KEY=original\n')
  })

  it('appends a second key without overwriting the first', () => {
    const envPath = path.join(tmpDir, '.env.local')
    fs.writeFileSync(envPath, 'FIRST=1\n', 'utf8')
    appendEnvKeyIfMissing(envPath, 'SECOND', '2')
    const vars = parseEnvFile(fs.readFileSync(envPath, 'utf8'))
    assert.equal(vars.FIRST, '1')
    assert.equal(vars.SECOND, '2')
  })
})

describe('Docker key persistence fallback', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-auth-docker-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keys written to fallback file survive simulated container restart', () => {
    // Simulate: write keys to a "data dir" fallback (like DATA_DIR/.env.generated)
    const generatedEnvPath = path.join(tmpDir, '.env.generated')
    appendEnvKeyIfMissing(generatedEnvPath, 'ACCESS_KEY', 'docker-key-123')
    appendEnvKeyIfMissing(generatedEnvPath, 'CREDENTIAL_SECRET', 'docker-secret-456')

    // Simulate restart: re-read the file (as loadEnvFile would)
    const vars = parseEnvFile(fs.readFileSync(generatedEnvPath, 'utf8'))
    assert.equal(vars.ACCESS_KEY, 'docker-key-123')
    assert.equal(vars.CREDENTIAL_SECRET, 'docker-secret-456')
  })

  it('fallback file does not overwrite keys that already exist', () => {
    const generatedEnvPath = path.join(tmpDir, '.env.generated')
    appendEnvKeyIfMissing(generatedEnvPath, 'ACCESS_KEY', 'original')

    // Second call should not overwrite
    appendEnvKeyIfMissing(generatedEnvPath, 'ACCESS_KEY', 'new-value')
    const vars = parseEnvFile(fs.readFileSync(generatedEnvPath, 'utf8'))
    assert.equal(vars.ACCESS_KEY, 'original')
  })
})

describe('credential secret persistence precedence', () => {
  it('migrates a legacy .env.local credential secret into DATA_DIR', () => {
    const legacySecret = 'a'.repeat(64)
    const output = runStorageAuthImport({
      envLocal: `CREDENTIAL_SECRET=${legacySecret}\n`,
    })

    assert.equal(output.credentialSecret, legacySecret)
    assert.equal(output.fileSecret, legacySecret)
    assert.equal(output.mode, '600')
  })

  it('uses the DATA_DIR credential secret before legacy env files', () => {
    const fileSecret = 'b'.repeat(64)
    const legacySecret = 'a'.repeat(64)
    const output = runStorageAuthImport({
      credentialSecretFile: fileSecret,
      envLocal: `CREDENTIAL_SECRET=${legacySecret}\n`,
    })

    assert.equal(output.credentialSecret, fileSecret)
    assert.equal(output.fileSecret, fileSecret)
  })

  it('lets an explicitly supplied environment credential secret override the file', () => {
    const externalSecret = 'c'.repeat(64)
    const fileSecret = 'b'.repeat(64)
    const output = runStorageAuthImport({
      externalCredentialSecret: externalSecret,
      credentialSecretFile: fileSecret,
    })

    assert.equal(output.credentialSecret, externalSecret)
    assert.equal(output.fileSecret, fileSecret)
  })

  it('recovers the previous npm-global build credential secret before persisting a fresh current cwd secret', () => {
    const previousSecret = 'd'.repeat(64)
    const freshCurrentSecret = 'e'.repeat(64)
    const output = runStorageAuthImport({
      swarmclawHome: true,
      envLocal: `CREDENTIAL_SECRET=${freshCurrentSecret}\n`,
      encryptedCredentialSecrets: [previousSecret],
      buildEnvFiles: [
        {
          relativePath: 'builds/package-1.9.32/.next/standalone/.env.local',
          content: `CREDENTIAL_SECRET=${previousSecret}\n`,
        },
      ],
    })

    assert.equal(output.credentialSecret, previousSecret)
    assert.equal(output.fileSecret, previousSecret)
  })

  it('replaces a non-decrypting DATA_DIR credential secret when a previous build secret decrypts existing credentials', () => {
    const previousSecret = 'f'.repeat(64)
    const wrongFileSecret = '1'.repeat(64)
    const output = runStorageAuthImport({
      swarmclawHome: true,
      credentialSecretFile: wrongFileSecret,
      encryptedCredentialSecrets: [previousSecret],
      buildEnvFiles: [
        {
          relativePath: 'builds/package-1.9.31/.next/standalone/.env.local.bak',
          content: `CREDENTIAL_SECRET=${previousSecret}\n`,
        },
      ],
    })

    assert.equal(output.credentialSecret, previousSecret)
    assert.equal(output.fileSecret, previousSecret)
  })

  it('keeps a DATA_DIR credential secret when it can decrypt existing credentials', () => {
    const workingFileSecret = '2'.repeat(64)
    const previousSecret = '3'.repeat(64)
    const output = runStorageAuthImport({
      swarmclawHome: true,
      credentialSecretFile: workingFileSecret,
      encryptedCredentialSecrets: [workingFileSecret],
      buildEnvFiles: [
        {
          relativePath: 'builds/package-1.9.31/.next/standalone/.env.local',
          content: `CREDENTIAL_SECRET=${previousSecret}\n`,
        },
      ],
    })

    assert.equal(output.credentialSecret, workingFileSecret)
    assert.equal(output.fileSecret, workingFileSecret)
  })
})
