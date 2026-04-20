#!/usr/bin/env bun
// One-off: download Google Fonts woff2 files to page/vendor/fonts/ and emit
// a local fonts.css. Re-run if the @import URL in page/index.html changes.
//
// Fetches the CSS with a modern Chrome UA so Google returns woff2 (the old
// TTF fallback is ~5x larger). Only keeps the `latin` subset — the site is
// English-only; latin-ext adds ~20KB for accented chars we don't render.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const OUT = 'page/vendor/fonts'

type Block = {
  family: string
  weight: string
  url: string
  subset: string
}

function parseBlocks(css: string): Block[] {
  const blocks: Block[] = []
  // Each @font-face is preceded by a subset comment like /* latin */.
  const re =
    /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{[^}]*?font-family:\s*'([^']+)'[^}]*?font-weight:\s*(\d+)[^}]*?src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    blocks.push({ subset: m[1], family: m[2], weight: m[3], url: m[4] })
  }
  return blocks
}

function localName(b: Block): string {
  const slug = b.family.toLowerCase().replace(/\s+/g, '-')
  return `${slug}-${b.weight}.woff2`
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const cssResp = await fetch(CSS_URL, { headers: { 'User-Agent': UA } })
  if (!cssResp.ok) throw new Error(`CSS fetch failed: ${cssResp.status}`)
  const css = await cssResp.text()

  const all = parseBlocks(css)
  const latin = all.filter((b) => b.subset === 'latin')
  if (latin.length === 0) throw new Error('No latin blocks parsed — CSS format changed?')

  let totalBytes = 0
  const faces: string[] = []
  for (const b of latin) {
    const resp = await fetch(b.url)
    if (!resp.ok) throw new Error(`Font fetch failed: ${b.url} → ${resp.status}`)
    const buf = Buffer.from(await resp.arrayBuffer())
    const name = localName(b)
    writeFileSync(join(OUT, name), buf)
    totalBytes += buf.length
    faces.push(
      `@font-face {
  font-family: '${b.family}';
  font-style: normal;
  font-weight: ${b.weight};
  font-display: swap;
  src: url(${name}) format('woff2');
}`,
    )
    console.log(`  ${name} — ${buf.length.toLocaleString()} bytes`)
  }

  writeFileSync(join(OUT, 'fonts.css'), faces.join('\n\n') + '\n')
  console.log(
    `Wrote ${latin.length} woff2 + fonts.css — ${totalBytes.toLocaleString()} bytes total`,
  )
}

await main()
