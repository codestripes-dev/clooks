import { expect, test } from 'bun:test'
import puppeteer from 'puppeteer'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import defaults from '../page/content.json'
import { ContentStore, startEditor } from './server'

test('edit copy, preview, undo, save and reopen the website', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clooks-editor-smoke-'))
  await mkdir(join(root, 'page'))
  await Bun.write(join(root, 'page/content.json'), JSON.stringify(defaults))
  const store = new ContentStore(root)
  const server = await startEditor(0, { store })
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('dialog', (dialog) => void dialog.accept())
    await page.setViewport({ width: 1600, height: 1000 })
    const origin = `http://127.0.0.1:${server.port}`
    await browser
      .defaultBrowserContext()
      .overridePermissions(origin, ['clipboard-read', 'clipboard-write'])
    await page.goto(origin + '/editor', { waitUntil: 'networkidle0' })
    async function click(label: string) {
      await page.evaluate((label) => {
        const button = [...document.querySelectorAll('button')].find(
          (el) =>
            (el.textContent?.trim() === label || el.title === label) &&
            el.getBoundingClientRect().width > 0,
        )
        if (!button || button.disabled) throw new Error(`Unavailable button: ${label}`)
        button.click()
      }, label)
    }
    await click('Hero')
    const preview = await (await page.waitForSelector('#preview-frame'))!.contentFrame()
    const title = 'Edited website heading'
    const original = await preview!.$eval('h1', (el) => el.textContent)
    const fields = await page.$$('[name="title"]')
    const field = (
      await Promise.all(fields.map(async (field) => ((await field.isVisible()) ? field : null)))
    ).find(Boolean)!
    await field.click({ clickCount: 3 })
    await page.keyboard.sendCharacter(title)
    await page.keyboard.press('Tab')
    await preview!.waitForFunction(
      (title) => document.querySelector('h1')?.textContent?.startsWith(title),
      {},
      title,
    )
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some((el) => el.title === 'undo' && !el.disabled),
    )
    await click('undo')
    await preview!.waitForFunction(
      (original) => document.querySelector('h1')?.textContent === original,
      {},
      original,
    )
    await click('redo')
    await preview!.waitForFunction(
      (title) => document.querySelector('h1')?.textContent?.startsWith(title),
      {},
      title,
    )
    await click('Save')
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.save-status')].some(
        (el) => el.getBoundingClientRect().width > 0 && el.textContent === 'Saved',
      ),
    )
    expect(
      (await store.read()).data.content.find((item) => item.type === 'Hero')!.props.title,
    ).toBe(title)
    await page.reload({ waitUntil: 'networkidle0' })
    const reloaded = await (await page.waitForSelector('#preview-frame'))!.contentFrame()
    await reloaded!.waitForFunction(
      (title) => document.querySelector('h1')?.textContent?.startsWith(title),
      {},
      title,
    )
    await page.goto(origin, { waitUntil: 'networkidle0' })
    await page.waitForSelector('#root[data-content-ready="true"]')
    const installSteps = defaults.content.find((item) => item.type === 'Hero')!.props.installSteps!
    const chips = await page.$$eval('h1 + p + div span', (elements) =>
      elements.map((el) => el.textContent).join(' '),
    )
    for (const label of ['Claude Code', 'Codex', 'Cursor', 'Windsurf', 'JetBrains'])
      expect(chips).toContain(label)
    expect(chips).not.toContain('Codex CLI')
    for (const width of [1600, 390]) {
      await page.setViewport({ width, height: 1000 })
      for (const agent of ['claude', 'codex'] as const) {
        const label = agent === 'claude' ? 'Claude' : 'Codex'
        await page.evaluate((label) => {
          const button = [
            ...document.querySelectorAll<HTMLButtonElement>('[data-install-one-liner] button'),
          ].find((el) => el.textContent === label)!
          button.click()
        }, label)
        await page.waitForFunction(
          (command) =>
            document.querySelector('[data-install-one-liner]')?.textContent?.includes(command),
          {},
          installSteps[agent].at(-1)!.cmd,
        )
        await page.click(`[aria-label="Copy ${label} one-liner"]`)
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
          installSteps[agent].map((step) => step.cmd).join(' && '),
        )
        expect(
          await page.$eval(
            '[data-install-one-liner] [aria-pressed="true"]',
            (el) => el.textContent,
          ),
        ).toBe(label)
      }
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth)
      for (const agent of ['claude', 'codex'] as const) {
        const label = defaults.content
          .find((item) => item.type === 'Install')!
          .props.paths!.find((path) => path.id === agent)!.label
        await page.evaluate((label) => {
          ;[...document.querySelectorAll<HTMLButtonElement>('#install button')]
            .find((button) => button.textContent === label)!
            .click()
        }, label)
        await page.click(`#install [aria-label="Copy ${label} one-liner"]`)
        expect(
          await page.$$eval('#install [data-shell-token="command"]', (tokens) =>
            tokens.map((token) => token.textContent),
          ),
        ).toContain(agent)
        expect(
          await page.$$eval('#install [data-shell-token="operator"]', (tokens) =>
            tokens.map((token) => token.textContent),
          ),
        ).toContain('&&')
        expect(
          await page.$eval('#install [data-shell-token="string"]', (token) => token.textContent),
        ).toBe(agent === 'claude' ? "'/clooks:setup'" : "'$clooks:setup'")
        const expected = installSteps[agent].map((step) => step.cmd)
        if (agent === 'claude') expected[2] = "claude '/clooks:setup'"
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
          expected.join(' && '),
        )
      }
      await page.evaluate(() => {
        ;[...document.querySelectorAll<HTMLButtonElement>('#install button')]
          .find((button) => button.textContent === 'Direct')!
          .click()
      })
      expect(await page.$('#install [aria-label$="one-liner"]')).toBeNull()
      await page.evaluate(() => window.scrollTo(0, 0))
      await mkdir(join(import.meta.dir, '../tmp/website-editor-validation'), { recursive: true })
      await page.screenshot({
        path: join(import.meta.dir, `../tmp/website-editor-validation/one-liner-${width}.png`),
      })
    }
    expect(await page.$eval('h1', (el) => el.textContent)).toStartWith(title)
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(10, 10, 10)',
    )
    await page.setViewport({ width: 390, height: 844 })
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth)
    expect(errors).toEqual([])
  } finally {
    await browser.close()
    server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
