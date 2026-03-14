import { join, resolve } from 'path'
import { existsSync, readFileSync } from 'fs'

const FIXTURES_DIR = resolve(process.env.FIXTURE_DIR!)

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url)
    const filePath = resolve(join(FIXTURES_DIR, url.pathname))

    // Prevent path traversal outside the fixtures directory
    if (!filePath.startsWith(FIXTURES_DIR)) {
      return new Response('Forbidden', { status: 403 })
    }

    if (!existsSync(filePath)) {
      return new Response('Not Found', { status: 404 })
    }

    const content = readFileSync(filePath, 'utf-8')
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  },
})

// Print URL so parent process can read it
console.log(`http://localhost:${server.port}`)
