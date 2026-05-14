'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildLegacyTsCliArgs, resolveLegacyTsCliPath, resolveTsxRuntimeImportPath } = require('../../bin/swarmclaw.js')

const CLI_BIN = path.join(__dirname, '..', '..', 'bin', 'swarmclaw.js')
const PACKAGE_JSON = require('../../package.json')
const APP_ROOT = path.join(__dirname, '..', '..')

function runBinary(args, options = {}) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: options.cwd || APP_ROOT,
    env: {
      ...process.env,
      ...options.env,
    },
    encoding: 'utf8',
  })
}

function runWithMockedFetch(args, options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-binary-fetch-'))
  const capturePath = path.join(tmpDir, 'capture.json')
  const preloadPath = path.join(tmpDir, 'mock-fetch.cjs')

  fs.writeFileSync(
    preloadPath,
    `
const fs = require('node:fs')
globalThis.fetch = async (url, init = {}) => {
  const capture = {
    url: String(url),
    method: init.method || 'GET',
    headers: init.headers || {},
    body: typeof init.body === 'string'
      ? init.body
      : (Buffer.isBuffer(init.body) ? init.body.toString('utf8') : null),
  }
  fs.writeFileSync(process.env.SWARMCLAW_TEST_CAPTURE, JSON.stringify(capture), 'utf8')
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
`,
    'utf8',
  )

  const nodeOptions = [process.env.NODE_OPTIONS, `--require=${preloadPath}`]
    .filter(Boolean)
    .join(' ')

  const result = runBinary(args, {
    ...options,
    env: {
      ...options.env,
      NODE_OPTIONS: nodeOptions,
      SWARMCLAW_TEST_CAPTURE: capturePath,
    },
  })

  const capture = fs.existsSync(capturePath)
    ? JSON.parse(fs.readFileSync(capturePath, 'utf8'))
    : null

  fs.rmSync(tmpDir, { recursive: true, force: true })
  return { result, capture }
}

test('legacy-routed binary commands honor SWARMCLAW_API_KEY', () => {
  const { result, capture } = runWithMockedFetch(
    ['runs', 'list', '--raw', '--url', 'http://localhost:3456'],
    {
      env: {
        SWARMCLAW_API_KEY: 'legacy-api-key',
        SWARMCLAW_ACCESS_KEY: '',
        SC_ACCESS_KEY: '',
      },
    },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), '[]')
  assert.equal(capture.headers['X-Access-Key'], 'legacy-api-key')
})

test('legacy-routed binary commands fall back to platform-api-key.txt', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-binary-keyfile-'))
  fs.writeFileSync(path.join(tmpDir, 'platform-api-key.txt'), 'file-fallback-key\n', 'utf8')

  const { result, capture } = runWithMockedFetch(
    ['runs', 'list', '--raw', '--url', 'http://localhost:3456'],
    {
      cwd: tmpDir,
      env: {
        SWARMCLAW_API_KEY: '',
        SWARMCLAW_ACCESS_KEY: '',
        SC_ACCESS_KEY: '',
      },
    },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), '[]')
  assert.equal(capture.headers['X-Access-Key'], 'file-fallback-key')

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('legacy-routed binary commands accept documented global aliases after the subcommand', () => {
  const { result, capture } = runWithMockedFetch(
    ['agents', 'list', '--access-key', 'alias-key', '--base-url', 'http://127.0.0.1:4567', '--json'],
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), '[]')
  assert.equal(capture.headers['X-Access-Key'], 'alias-key')
  assert.equal(capture.url, 'http://127.0.0.1:4567/api/agents')
})

test('binary server help exits successfully', () => {
  const result = runBinary(['server', '--help'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage: swarmclaw server/i)
})

test('binary run alias routes to server help', () => {
  const result = runBinary(['run', '--help'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage: swarmclaw server/i)
})

test('binary help command shows root help', () => {
  const result = runBinary(['help'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /SwarmClaw CLI/i)
  assert.match(result.stdout, /swarmclaw help \[command\]/i)
})

test('binary help command shows command help for run alias', () => {
  const result = runBinary(['help', 'run'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage: swarmclaw server/i)
})

test('binary help command shows command help for doctor alias', () => {
  const result = runBinary(['help', 'doctor'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage: swarmclaw doctor/i)
})

test('binary status alias routes to local server status', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarmclaw-binary-status-'))
  const result = runBinary(['status'], {
    env: {
      SWARMCLAW_HOME: homeDir,
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Server: not running/i)

  fs.rmSync(homeDir, { recursive: true, force: true })
})

test('binary doctor help exits successfully', () => {
  const result = runBinary(['doctor', '--help'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage: swarmclaw doctor/i)
})

test('binary update help exits successfully', () => {
  const result = runBinary(['update', '--help'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage: swarmclaw update/i)
})

test('binary version output matches package version', () => {
  const result = runBinary(['--version'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), `${PACKAGE_JSON.name} ${PACKAGE_JSON.version}`)
})

test('binary bare version alias output matches package version', () => {
  const result = runBinary(['version'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), `${PACKAGE_JSON.name} ${PACKAGE_JSON.version}`)
})

test('binary -v alias output matches package version', () => {
  const result = runBinary(['-v'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), `${PACKAGE_JSON.name} ${PACKAGE_JSON.version}`)
})

test('package ships dagre type declarations required by installed builds', () => {
  assert.equal(PACKAGE_JSON.dependencies.dagre, '^0.8.5')
  assert.equal(PACKAGE_JSON.dependencies['@types/dagre'], '^0.7.54')
  assert.equal(PACKAGE_JSON.devDependencies?.['@types/dagre'], undefined)
})

test('legacy TS launcher falls back to tsx import when strip-types is unavailable', () => {
  const cliPath = path.join(APP_ROOT, 'src', 'cli', 'index.ts')
  const tsxImportPath = resolveTsxRuntimeImportPath()
  const args = buildLegacyTsCliArgs(cliPath, ['runs', 'list'], {
    supportsStripTypes: false,
    hasTsxRuntime: true,
  })

  assert.deepEqual(args, ['--no-warnings', '--import', tsxImportPath, cliPath, 'runs', 'list'])
})

test('legacy TS launcher uses tsx instead of strip-types inside node_modules', () => {
  const cliPath = path.join(os.tmpdir(), 'node_modules', '@swarmclawai', 'swarmclaw', 'src', 'cli', 'index.ts')
  const tsxImportPath = resolveTsxRuntimeImportPath()
  const args = buildLegacyTsCliArgs(cliPath, ['agents', 'list'], {
    supportsStripTypes: true,
    hasTsxRuntime: true,
  })

  assert.deepEqual(args, ['--no-warnings', '--import', tsxImportPath, cliPath, 'agents', 'list'])
  assert.equal(resolveLegacyTsCliPath(), path.join(APP_ROOT, 'src', 'cli', 'index.ts'))
})

test('legacy TS launcher imports the package-local tsx runtime by absolute path', () => {
  const tsxImportPath = resolveTsxRuntimeImportPath()

  assert.equal(path.isAbsolute(tsxImportPath), true)
  assert.match(tsxImportPath, /tsx/)
})
