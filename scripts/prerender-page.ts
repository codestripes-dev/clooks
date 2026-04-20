#!/usr/bin/env bun
// Prerender page/ into dist/ so crawlers and AI agents see fully-rendered HTML.
// Copies page/* to dist/, serves dist/ locally, loads it in headless Chrome,
// waits for React to mount, and writes the settled DOM back as dist/index.html.
// React still loads client-side for real users (createRoot re-renders on mount).

import puppeteer from 'puppeteer'
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

async function prerender(port: number): Promise<string> {
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
    return await page.evaluate(() => '<!DOCTYPE html>\n' + document.documentElement.outerHTML)
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  const t0 = performance.now()
  copyPageToDist()
  const server = await serveDist()
  try {
    const html = await prerender(server.port)
    if (html.length < 1000)
      throw new Error(`Rendered HTML suspiciously small: ${html.length} bytes`)
    writeFileSync(join(OUT, 'index.html'), html)
    const bytes = statSync(join(OUT, 'index.html')).size
    const ms = Math.round(performance.now() - t0)
    console.log(`Prerendered dist/index.html — ${bytes.toLocaleString()} bytes in ${ms}ms`)
  } finally {
    server.stop()
  }
}

await main()
