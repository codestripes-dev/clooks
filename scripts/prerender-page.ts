#!/usr/bin/env bun
// Prerender page/ into dist/ so crawlers and AI agents see fully-rendered HTML.
// Copies page/* to dist/, serves dist/ locally, loads it in headless Chrome,
// waits for React to mount, and writes the settled DOM back as dist/index.html.
// React still loads client-side for real users (createRoot re-renders on mount).

import puppeteer from 'puppeteer'
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const SRC = 'page'
const OUT = 'dist'
const RENDER_TIMEOUT_MS = 15_000

function copyPageToDist(): void {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  for (const entry of readdirSync(SRC, { withFileTypes: true })) {
    if (entry.isFile()) copyFileSync(join(SRC, entry.name), join(OUT, entry.name))
  }
}

async function serveDist(): Promise<{ port: number; stop: () => void }> {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname === '/' ? '/index.html' : url.pathname
      const file = Bun.file(join(OUT, path))
      if (!(await file.exists())) return new Response('Not Found', { status: 404 })
      return new Response(file)
    },
  })
  return { port: server.port, stop: () => void server.stop(true) }
}

// Capture only the rendered #root markup. We splice it into the original
// index.html template so the script tags stay in their original order and
// scope. (Babel Standalone appends transpiled `<script>` tags to <head> at
// runtime — capturing the whole document would bake those in, and they'd
// execute before the React UMD scripts on the next load.)
async function prerenderRoot(port: number): Promise<string> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root')
        return root !== null && root.children.length > 0
      },
      { timeout: RENDER_TIMEOUT_MS },
    )
    return await page.evaluate(() => {
      const root = document.getElementById('root')
      return root ? root.innerHTML : ''
    })
  } finally {
    await browser.close()
  }
}

function spliceIntoTemplate(template: string, rootHtml: string): string {
  const marker = '<div id="root"></div>'
  if (!template.includes(marker)) {
    throw new Error(`Expected template to contain ${marker}`)
  }
  return template.replace(marker, `<div id="root">${rootHtml}</div>`)
}

async function main(): Promise<void> {
  const t0 = performance.now()
  copyPageToDist()
  const server = await serveDist()
  try {
    const rootHtml = await prerenderRoot(server.port)
    if (rootHtml.length < 1000)
      throw new Error(`Rendered #root suspiciously small: ${rootHtml.length} bytes`)
    const template = readFileSync(join(SRC, 'index.html'), 'utf8')
    writeFileSync(join(OUT, 'index.html'), spliceIntoTemplate(template, rootHtml))
    const bytes = statSync(join(OUT, 'index.html')).size
    const ms = Math.round(performance.now() - t0)
    console.log(`Prerendered dist/index.html — ${bytes.toLocaleString()} bytes in ${ms}ms`)
  } finally {
    server.stop()
  }
}

await main()
