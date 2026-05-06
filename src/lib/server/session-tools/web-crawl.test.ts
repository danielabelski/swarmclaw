import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { buildWebTools } from './web'
import type { ToolBuildContext } from './context'

const originalFetch = globalThis.fetch

function createContext(): ToolBuildContext {
  return {
    cwd: process.cwd(),
    ctx: undefined,
    hasExtension: (name: string) => name === 'web',
    hasTool: (name: string) => name === 'web',
    cleanupFns: [],
    commandTimeoutMs: 1000,
    claudeTimeoutMs: 1000,
    cliProcessTimeoutMs: 1000,
    persistDelegateResumeId: () => {},
    readStoredDelegateResumeId: () => null,
    resolveCurrentSession: () => null,
    activeExtensions: ['web'],
  } as ToolBuildContext
}

function mockFetch(pages: Record<string, string>, calls: string[] = []): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    calls.push(url)
    const html = pages[url]
    if (!html) {
      return new Response('missing', { status: 404, statusText: 'Not Found' })
    }
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('web extract and crawl tools', () => {
  it('registers direct granular web tools when web is enabled', () => {
    const names = buildWebTools(createContext()).map((entry) => entry.name).sort()

    assert.deepEqual(names.filter((name) => name.startsWith('web')), [
      'web',
      'web_crawl',
      'web_extract',
      'web_fetch',
      'web_search',
    ])
  })

  it('extracts readable page content with title and source URL', async () => {
    mockFetch({
      'https://example.test/article': `
        <!doctype html>
        <title>Feature Page</title>
        <header>Ignore navigation</header>
        <main>
          <h1>Feature Page</h1>
          <p>Readable body text for the agent.</p>
        </main>
        <script>console.log('hidden')</script>
      `,
    })
    const tool = buildWebTools(createContext()).find((entry) => entry.name === 'web_extract')
    assert.ok(tool)

    const output = String(await tool.invoke({ url: 'https://example.test/article#section' }))

    assert.match(output, /Title: Feature Page/)
    assert.match(output, /URL: https:\/\/example\.test\/article/)
    assert.match(output, /Readable body text for the agent\./)
    assert.doesNotMatch(output, /Ignore navigation/)
    assert.doesNotMatch(output, /console\.log/)
  })

  it('crawls same-origin pages within the requested page and depth bounds', async () => {
    const calls: string[] = []
    mockFetch({
      'https://site.test/': `
        <title>Start</title>
        <main>Start page <a href="/a">A</a> <a href="/b">B</a> <a href="https://external.test/x">External</a></main>
      `,
      'https://site.test/a': '<title>A page</title><main>Alpha content</main>',
      'https://site.test/b': '<title>B page</title><main>Beta content</main>',
      'https://external.test/x': '<title>External</title><main>Should not be fetched</main>',
    }, calls)
    const tool = buildWebTools(createContext()).find((entry) => entry.name === 'web_crawl')
    assert.ok(tool)

    const output = String(await tool.invoke({ url: 'https://site.test/', maxPages: 3, maxDepth: 1 }))

    assert.match(output, /Crawl results for: https:\/\/site\.test\//)
    assert.match(output, /Pages crawled: 3/)
    assert.match(output, /Start page/)
    assert.match(output, /Alpha content/)
    assert.match(output, /Beta content/)
    assert.doesNotMatch(output, /Should not be fetched/)
    assert.deepEqual(calls, ['https://site.test/', 'https://site.test/a', 'https://site.test/b'])
  })
})
