#!/usr/bin/env bun
// One-off: generates page/og-image.png (1200x630) for social unfurls.
// Re-run manually if the brand/wordmark changes.

import puppeteer from 'puppeteer'
import { writeFileSync } from 'node:fs'

const html = `<!doctype html>
<html><head><style>
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@500;600&family=JetBrains+Mono:wght@600&display=swap');
  html, body { margin: 0; padding: 0; width: 1200px; height: 630px; background: #0a0a0a; }
  .card {
    width: 100%; height: 100%; box-sizing: border-box;
    padding: 80px; display: flex; flex-direction: column; justify-content: space-between;
    font-family: 'Geist', system-ui, sans-serif; color: #f5f5f2;
    background: radial-gradient(circle at 85% 15%, rgba(251,191,36,0.08), transparent 50%), #0a0a0a;
    border-left: 6px solid #fbbf24;
  }
  .brand { display: flex; align-items: center; gap: 24px; }
  .brand svg { display: block; }
  .wordmark { font-family: 'JetBrains Mono', monospace; font-size: 64px; font-weight: 600; letter-spacing: -1.5px; }
  .headline { font-size: 72px; line-height: 1.05; font-weight: 600; letter-spacing: -2px; max-width: 900px; }
  .accent { color: #fbbf24; }
  .footer { display: flex; justify-content: space-between; align-items: flex-end; color: #a1a1aa; font-size: 24px; }
  .url { font-family: 'JetBrains Mono', monospace; color: #fbbf24; }
</style></head><body>
  <div class="card">
    <div class="brand">
      <svg width="72" height="72" viewBox="0 0 22 22" fill="none">
        <path d="M4 4 L4 18 L10 18" stroke="#fbbf24" stroke-width="2" stroke-linecap="square" fill="none"/>
        <path d="M18 4 L18 18 L12 18" stroke="#f5f5f2" stroke-width="2" stroke-linecap="square" fill="none"/>
      </svg>
      <div class="wordmark">clooks</div>
    </div>
    <div class="headline">TypeScript hooks<br/>for <span class="accent">AI coding agents</span>.</div>
    <div class="footer">
      <span>Typed contracts. Fail-closed. Composable.</span>
      <span class="url">clooks.cc</span>
    </div>
  </div>
</body></html>`

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 300))
  const buf = await page.screenshot({ type: 'png', omitBackground: false })
  writeFileSync('page/og-image.png', buf)
  console.log(`Wrote page/og-image.png — ${buf.length.toLocaleString()} bytes`)
} finally {
  await browser.close()
}
