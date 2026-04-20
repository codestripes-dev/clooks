#!/usr/bin/env bun
// Prerender page/ into dist/ so crawlers and AI agents see fully-rendered HTML.
// Copies page/* to dist/, transpiles .jsx → .js (removes Babel Standalone from
// the runtime), serves dist/ locally, loads it in headless Chrome, waits for
// React to mount, and writes the settled DOM back as dist/index.html.
//
// Local dev (`open page/index.html`) still uses Babel Standalone in-browser;
// only the deployed dist/ drops it.

import puppeteer from 'puppeteer'
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'page'
const OUT = 'dist'
const RENDER_TIMEOUT_MS = 15_000

function copyPageToDist(): void {
  rmSync(OUT, { recursive: true, force: true })
  cpSync(SRC, OUT, { recursive: true })
}

// Transpile every .jsx in dist/ to .js (classic React.createElement transform)
// and delete the .jsx sources. Bun's transpiler ships with the runtime.
function transpileJsxFiles(): void {
  const transpiler = new Bun.Transpiler({
    loader: 'jsx',
    tsconfig: JSON.stringify({
      compilerOptions: {
        jsx: 'react',
        jsxFactory: 'React.createElement',
        jsxFragmentFactory: 'React.Fragment',
      },
    }),
  })
  for (const entry of readdirSync(OUT)) {
    if (!entry.endsWith('.jsx')) continue
    const src = join(OUT, entry)
    const out = src.replace(/\.jsx$/, '.js')
    const code = transpiler.transformSync(readFileSync(src, 'utf8'))
    writeFileSync(out, code)
    rmSync(src)
  }
}

// Rewrite dist/index.html to drop Babel Standalone, swap .jsx refs to .js,
// and extract the inline <script type="text/babel"> App block into app.js.
function transformIndexHtml(): void {
  const indexPath = join(OUT, 'index.html')
  let html = readFileSync(indexPath, 'utf8')

  html = html.replace(
    /\n?<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"[^>]*><\/script>/g,
    '',
  )

  html = html.replace(
    /<script type="text\/babel" src="([^"]+)\.jsx"><\/script>/g,
    '<script src="$1.js"></script>',
  )

  const inlineMatch = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)
  if (inlineMatch) {
    const transpiler = new Bun.Transpiler({
      loader: 'jsx',
      tsconfig: JSON.stringify({
        compilerOptions: {
          jsx: 'react',
          jsxFactory: 'React.createElement',
          jsxFragmentFactory: 'React.Fragment',
        },
      }),
    })
    const transpiled = transpiler.transformSync(inlineMatch[1])
    writeFileSync(join(OUT, 'app.js'), transpiled)
    html = html.replace(inlineMatch[0], '<script src="app.js"></script>')
  }

  // Defer all same-origin scripts — they become non-render-blocking while
  // still executing in source order after parse.
  html = html.replace(/<script src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')

  writeFileSync(indexPath, html)
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

// Capture only the rendered #root markup. We splice it back into the
// transformed dist/index.html so all the (now plain) <script> tags stay in
// their original order and scope.
async function prerenderRoot(port: number): Promise<string> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root')
        return root !== null && root.children.length > 0
      },
      { timeout: RENDER_TIMEOUT_MS },
    )
    if (pageErrors.length > 0) {
      throw new Error(`Page errors during prerender:\n  ${pageErrors.join('\n  ')}`)
    }
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
  transpileJsxFiles()
  transformIndexHtml()
  const server = await serveDist()
  try {
    const rootHtml = await prerenderRoot(server.port)
    if (rootHtml.length < 1000)
      throw new Error(`Rendered #root suspiciously small: ${rootHtml.length} bytes`)
    const template = readFileSync(join(OUT, 'index.html'), 'utf8')
    writeFileSync(join(OUT, 'index.html'), spliceIntoTemplate(template, rootHtml))
    const bytes = statSync(join(OUT, 'index.html')).size
    const ms = Math.round(performance.now() - t0)
    console.log(`Prerendered dist/index.html — ${bytes.toLocaleString()} bytes in ${ms}ms`)
  } finally {
    server.stop()
  }
}

await main()
