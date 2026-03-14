import { join } from 'path'

// @ts-ignore
const FIXTURES_DIR = join(import.meta.dir, '../../fixtures/github-raw')
// @ts-ignore
const SERVER_SCRIPT = join(import.meta.dir, 'fixture-server-process.ts')

export interface FixtureServer {
  url: string
  stop: () => void
}

/**
 * Starts a fixture server in a child process (so Bun.spawnSync in tests
 * doesn't block the server's event loop). The child writes its URL to stdout
 * on startup.
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const proc = Bun.spawn(['bun', 'run', SERVER_SCRIPT], {
    stdout: 'pipe',
    stderr: 'inherit',
    env: { ...process.env, FIXTURE_DIR: FIXTURES_DIR },
  })

  // Buffer stdout until we get a complete line with the URL
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
  let buffer = ''

  const urlPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += new TextDecoder().decode(value)
      if (buffer.includes('\n')) break
    }
    reader.releaseLock()
    return buffer.trim()
  })()

  const url = await Promise.race([
    urlPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Fixture server did not start within 5s')), 5000),
    ),
  ])

  if (!url.startsWith('http')) {
    proc.kill()
    throw new Error(`Fixture server failed to start. Got: ${url}`)
  }

  return {
    url,
    stop: () => proc.kill(),
  }
}
