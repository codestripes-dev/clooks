import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer'
import defaults from '../page/content.json'
import { websiteRoot } from './page-assets'

test('prerender waits for saved content, escapes metadata and dollars, and preserves all unrelated artifacts', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'clooks-prerender-'))
  const source = join(temporary, 'page'),
    output = join(temporary, 'dist')
  const special = '$& $$ $` $\' "quoted"\n</script><script>window.injected=true</script>'
  try {
    await cp(join(websiteRoot, 'page'), source, { recursive: true })
    const data = structuredClone(defaults)
    data.root.props.metadata.title = special
    data.root.props.metadata.description = special
    data.root.props.metadata.canonical = ''
    data.root.props.metadata.image = ''
    data.content[0].props.title = special
    await Bun.write(join(source, 'content.json'), JSON.stringify(data))
    const build = async () => {
      const process = Bun.spawn(
        [Bun.which('bun')!, join(websiteRoot, 'scripts/prerender-page.ts')],
        {
          cwd: websiteRoot,
          env: { ...Bun.env, PAGE_SOURCE_DIR: source, PAGE_OUTPUT_DIR: output },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [code, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ])
      expect(stderr).toBe('')
      expect(code).toBe(0)
    }
    await build() // Output directory does not exist on the first build.
    const artifacts = [
      'clooks',
      'SHA256SUMS',
      'release.sig',
      'signatures/release.asc',
      'unrelated.jsx',
    ]
    await mkdir(join(output, 'signatures'))
    for (const file of artifacts) await Bun.write(join(output, file), `preserve ${file}`)
    await build()
    for (const file of artifacts)
      expect(await Bun.file(join(output, file)).text()).toBe(`preserve ${file}`)
    const html = await readFile(join(output, 'index.html'), 'utf8')
    expect(html).not.toContain('@puckeditor')
    expect(html).not.toContain('/editor-assets/')
    expect(html).not.toContain('text/babel')
    expect(html).not.toContain('</script><script>window.injected')
    expect(html).toContain('\\u003c/script>')
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    try {
      const page = await browser.newPage()
      const result = await page.evaluate((html) => {
        const document = new DOMParser().parseFromString(html, 'text/html')
        return {
          title: document.title,
          heading: document.querySelector('h1')?.textContent,
          description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
          ld: JSON.parse(
            document.querySelector('script[type="application/ld+json"]')!.textContent!,
          ),
          canonical: document.querySelector('link[rel="canonical"]'),
          image: document.querySelector('meta[property="og:image"]'),
          roots: document.querySelectorAll('#root').length,
        }
      }, html)
      // HTML title normalizes line breaks; content attributes and JSON stay exact.
      expect(result.title).toBe(special.replace('\n', ' '))
      expect(result.heading).toStartWith(special)
      expect(result.description).toBe(special)
      expect(result.ld.description).toBe(special)
      expect(result.canonical).toBeNull()
      expect(result.image).toBeNull()
      expect(result.roots).toBe(1)
    } finally {
      await browser.close()
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, 30_000)
