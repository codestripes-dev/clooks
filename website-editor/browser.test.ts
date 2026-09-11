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
}, 30_000)
