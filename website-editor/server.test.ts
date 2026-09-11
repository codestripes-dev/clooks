import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateContent, type PageData } from './content-schema'
import { ContentStore, createHandler, MAX_SAVE_BYTES } from './server'

const origin = 'http://127.0.0.1:43123'
const token = 'standalone-test-csrf-token'
const correctRequestHost = new URL(origin).host
const assets = new Map([
  ['/', { body: '<!doctype html><title>Test page</title>', type: 'text/html; charset=utf-8' }],
  [
    '/editor',
    { body: '<!doctype html><title>Test editor</title>', type: 'text/html; charset=utf-8' },
  ],
  ['/site.js', { body: 'window.testAsset = true;', type: 'text/javascript; charset=utf-8' }],
])

describe('website editor backend', () => {
  let tempRoot: string
  let contentPath: string
  let original: string
  let data: PageData
  let revision: string
  let store: ContentStore
  let handler: ReturnType<typeof createHandler>

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'clooks-website-editor-'))
    await mkdir(join(tempRoot, 'page'))
    contentPath = join(tempRoot, 'page/content.json')
    await copyFile(join(import.meta.dir, '../page/content.json'), contentPath)
    original = await readFile(contentPath, 'utf8')
    data = validateContent(JSON.parse(original))
    revision = createHash('sha256').update(original).digest('hex')
    store = new ContentStore(tempRoot)
    handler = createHandler({ origin: () => origin, token, store, assets })
  })

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  function request(path = '/api/content', init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    if (!headers.has('host')) headers.set('host', correctRequestHost)
    return new Request(origin + path, { ...init, headers })
  }

  function saveRequest(value: unknown = { revision, data }, headers: Record<string, string> = {}) {
    return request('/api/content', {
      method: 'PUT',
      headers: { origin, 'x-csrf-token': token, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(value),
    })
  }

  async function unchanged() {
    expect(await readFile(contentPath, 'utf8')).toBe(original)
    expect(await readdir(join(tempRoot, 'page'))).toEqual(['content.json'])
  }

  async function rejected(req: Request, status: number) {
    const response = await handler(req)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: expect.any(String) })
    await unchanged()
  }

  test('reads validated content with a revision, CSRF token, and private response headers', async () => {
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data, revision, csrf: token })
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    await unchanged()
  })

  test('roundtrips quotes, newlines, dollar signs, and reordered hidden sections through a save', async () => {
    const hero = data.content.find((item) => item.type === 'Hero')!
    hero.props.intro = 'A "quoted" introduction\nA second line with $HOME and ${value}.'
    hero.props.commands[0]!.cmd = 'printf \'"%s"\\n\' "$HOME"\necho "$1"'
    hero.props.visible = false
    data.root.props.metadata.description = 'Quotes: "double", \'single\'\nPrice: $25'
    data.content.reverse()
    const response = await handler(
      saveRequest(undefined, { 'content-type': 'application/json; charset=utf-8' }),
    )
    expect(response.status).toBe(200)
    const saved = await response.json()
    const bytes = await readFile(contentPath, 'utf8')
    expect(JSON.parse(bytes)).toEqual(data)
    expect(saved).toEqual({ data, revision: createHash('sha256').update(bytes).digest('hex') })
    expect(saved.revision).not.toBe(revision)
    expect(await (await handler(request())).json()).toEqual({ ...saved, csrf: token })
    expect(await (await handler(request('/content.json'))).json()).toEqual(data)
    expect(await readdir(join(tempRoot, 'page'))).toEqual(['content.json'])
  })

  test('rejects a stale revision after an external disk edit and permits a fresh retry', async () => {
    const external = structuredClone(data)
    external.root.props.metadata.title = 'External edit'
    original = JSON.stringify(external) + '\n'
    await writeFile(contentPath, original)
    await rejected(saveRequest(), 409)
    const current = await store.read()
    const response = await handler(saveRequest({ revision: current.revision, data }))
    expect(response.status).toBe(200)
    expect((await store.read()).data).toEqual(data)
  })

  test('preserves an external edit made after preparing the temporary save and recovers the queue', async () => {
    const external = structuredClone(data)
    external.root.props.metadata.title = 'External edit during atomic save'
    const externalBytes = JSON.stringify(external) + '\n'
    let reads = 0
    let temporaryFiles: string[] = []
    class ExternallyEditedStore extends ContentStore {
      override async read() {
        if (++reads === 2) {
          temporaryFiles = (await readdir(join(tempRoot, 'page'))).filter((name) =>
            /^\.content-.*\.tmp$/.test(name),
          )
          expect(temporaryFiles).toHaveLength(1)
          expect(
            JSON.parse(await readFile(join(tempRoot, 'page', temporaryFiles[0]!), 'utf8')),
          ).toEqual(data)
          await writeFile(contentPath, externalBytes)
        }
        return super.read()
      }
    }
    store = new ExternallyEditedStore(tempRoot)
    handler = createHandler({ origin: () => origin, token, store, assets })
    const response = await handler(saveRequest())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: expect.any(String) })
    expect(reads).toBe(2)
    expect(temporaryFiles).toHaveLength(1)
    expect(await readFile(contentPath, 'utf8')).toBe(externalBytes)
    expect(await readdir(join(tempRoot, 'page'))).toEqual(['content.json'])

    const current = await store.read()
    const retry = await handler(saveRequest({ revision: current.revision, data }))
    expect(retry.status).toBe(200)
    expect((await store.read()).data).toEqual(data)
    expect(await readdir(join(tempRoot, 'page'))).toEqual(['content.json'])
  })

  test('serializes competing writes so only one draft wins and the queue remains usable', async () => {
    const drafts = ['First writer', 'Second writer'].map((title) => {
      const draft = structuredClone(data)
      draft.root.props.metadata.title = title
      return draft
    })
    const responses = await Promise.all(
      drafts.map((data) => handler(saveRequest({ revision, data }))),
    )
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const winner = responses.findIndex((response) => response.status === 200)
    const saved = await responses[winner]!.json()
    expect((await store.read()).data).toEqual(drafts[winner])
    expect((await handler(saveRequest({ revision: saved.revision, data }))).status).toBe(200)
    expect((await store.read()).data).toEqual(data)
    expect(await readdir(join(tempRoot, 'page'))).toEqual(['content.json'])
  })

  test('rejects invalid field values and section invariants without writing', async () => {
    const mutations: Array<(draft: PageData) => void> = [
      (draft) => {
        draft.root.props.accent = 'red'
      },
      (draft) => {
        draft.root.props.metadata.title = ''
      },
      (draft) => {
        draft.content[1]!.props.id = draft.content[0]!.props.id
      },
      (draft) => {
        draft.content[1] = structuredClone(draft.content[0]!)
      },
      (draft) => {
        draft.content.pop()
      },
      (draft) => {
        const hero = draft.content.find((item) => item.type === 'Hero')!
        hero.props.links[0]!.href = 'javascript:alert(1)'
      },
    ]
    for (const mutate of mutations) {
      const draft = structuredClone(data)
      mutate(draft)
      await rejected(saveRequest({ revision, data: draft }), 400)
    }
    await rejected(saveRequest({ revision: 'not-a-revision', data }), 400)
  })

  test('rejects unknown fields at the save, page, root, section, and nested property boundaries', async () => {
    await rejected(saveRequest({ revision, data, filename: '../globalconfig.json' }), 400)
    const targets = [
      (draft: PageData) => draft,
      (draft: PageData) => draft.root,
      (draft: PageData) => draft.root.props,
      (draft: PageData) => draft.root.props.metadata,
      (draft: PageData) => draft.content[0]!,
      (draft: PageData) => draft.content[0]!.props,
    ]
    for (const target of targets) {
      const draft = structuredClone(data)
      Object.assign(target(draft), { unexpected: 'must not be silently discarded' })
      await rejected(saveRequest({ revision, data: draft }), 400)
    }
  })

  test('rejects malformed, absent, and non-envelope JSON without writing', async () => {
    for (const body of ['{"revision":', '', 'null', '[]']) {
      const req = saveRequest()
      await rejected(new Request(req, { body }), 400)
    }
    await rejected(
      request('/api/content', {
        method: 'PUT',
        headers: { origin, 'x-csrf-token': token, 'content-type': 'application/json' },
      }),
      400,
    )
  })

  test('bounds both declared length and actual streamed JSON bytes', async () => {
    await rejected(saveRequest(undefined, { 'content-length': String(MAX_SAVE_BYTES + 1) }), 413)
    await rejected(saveRequest(undefined, { 'content-length': 'not-a-number' }), 413)
    const bytes = new TextEncoder().encode(JSON.stringify({ padding: 'x'.repeat(MAX_SAVE_BYTES) }))
    for (const declaredLength of [undefined, '1']) {
      const req = saveRequest()
      if (declaredLength !== undefined) req.headers.set('content-length', declaredLength)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 100))
          controller.enqueue(bytes.subarray(100))
          controller.close()
        },
      })
      await rejected(new Request(req, { body }), 413)
    }
  })

  test('times out a valid save envelope whose request stream never closes without writing', async () => {
    data.root.props.metadata.title = 'This stalled draft must never reach disk'
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ revision, data })))
        // A complete JSON value is not a complete request until the stream closes.
      },
      cancel() {
        cancelled = true
      },
    })
    const response = await handler(new Request(saveRequest(), { body }))
    expect(cancelled).toBe(true)
    await unchanged()
    expect(response.status).toBe(408)
    expect(await response.json()).toEqual({ error: expect.any(String) })
  }, 15_000)

  test('requires JSON MIME type and rejects form-compatible or missing types', async () => {
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'application/jsonp',
      'application/json; charset=latin1',
    ]) {
      await rejected(saveRequest(undefined, { 'content-type': type }), 415)
    }
    const req = saveRequest()
    req.headers.delete('content-type')
    await rejected(req, 415)
  })

  test('requires the exact save Origin and CSRF token', async () => {
    for (const header of ['origin', 'x-csrf-token']) {
      const missing = saveRequest()
      missing.headers.delete(header)
      await rejected(missing, 403)
      await rejected(saveRequest(undefined, { [header]: 'https://attacker.example' }), 403)
    }
    await rejected(saveRequest(undefined, { 'sec-fetch-site': 'cross-site' }), 403)
  })

  test('rejects hostile Host, URL origin, and cross-origin reads before serving content or assets', async () => {
    for (const path of ['/api/content', '/content.json', '/']) {
      await rejected(request(path, { headers: { host: 'attacker.example' } }), 403)
      await rejected(request(path, { headers: { origin: 'https://attacker.example' } }), 403)
      const missing = request(path)
      missing.headers.delete('host')
      await rejected(missing, 403)
      await rejected(
        new Request('http://attacker.example' + path, { headers: { host: correctRequestHost } }),
        403,
      )
    }
    await rejected(saveRequest(undefined, { host: 'attacker.example' }), 403)
  })

  test('serves only exact in-memory routes, with HEAD and method restrictions', async () => {
    for (const [path, asset] of assets) {
      const response = await handler(request(path))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(asset.type)
      expect(await response.text()).toBe(asset.body)
      const head = await handler(request(path, { method: 'HEAD' }))
      expect(head.status).toBe(200)
      expect(head.headers.get('content-type')).toBe(asset.type)
      expect(await head.text()).toBe('')
      await rejected(request(path, { method: 'POST' }), 405)
    }
    const head = await handler(request('/content.json', { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    await rejected(request('/content.json', { method: 'PUT' }), 405)
    await rejected(request('/api/content', { method: 'POST' }), 405)
    // Encoded separators survive URL normalization and must never become disk paths.
    for (const path of [
      '/editor/',
      '/site.js/extra',
      '/site.js?cache=1',
      '/page/content.json',
      '/globalconfig.json',
      '/server.ts',
      '/%2e%2e%2fglobalconfig.json',
      '/..%5cglobalconfig.json',
      '/%73ite.js',
      '//site.js',
    ]) {
      await rejected(request(path), 404)
    }
  })

  test('refuses symlinked content files and parent directories without modifying their targets', async () => {
    const target = join(tempRoot, 'target.json')
    await rename(contentPath, target)
    await symlink(target, contentPath)
    await expect(store.read()).rejects.toThrow('Symlinks are not allowed')
    await expect(store.save(revision, data)).rejects.toThrow('Symlinks are not allowed')
    expect(await readFile(target, 'utf8')).toBe(original)
    await rm(contentPath)
    await rename(target, contentPath)
    const targetDirectory = join(tempRoot, 'target-page')
    await rename(join(tempRoot, 'page'), targetDirectory)
    await symlink(targetDirectory, join(tempRoot, 'page'))
    await expect(store.read()).rejects.toThrow('Symlinks are not allowed')
    await expect(store.save(revision, data)).rejects.toThrow('Symlinks are not allowed')
    expect(await readFile(join(targetDirectory, 'content.json'), 'utf8')).toBe(original)
    expect(await readdir(targetDirectory)).toEqual(['content.json'])
  })

  test('reloads persisted content and revision in a recreated store and handler', async () => {
    data.root.props.metadata.title = 'Persisted across editor sessions'
    const response = await handler(saveRequest())
    expect(response.status).toBe(200)
    const saved = await response.json()
    const replacement = new ContentStore(tempRoot)
    const nextHandler = createHandler({
      origin: () => origin,
      token: 'new-session-token',
      store: replacement,
      assets,
    })
    expect(await replacement.read()).toEqual(saved)
    expect(await (await nextHandler(request())).json()).toEqual({
      ...saved,
      csrf: 'new-session-token',
    })
    expect(await (await nextHandler(request('/content.json'))).json()).toEqual(data)
    const nextDraft = structuredClone(data)
    nextDraft.root.props.metadata.title = 'Saved from the recreated editor'
    const nextSave = await nextHandler(
      saveRequest(
        { revision: saved.revision, data: nextDraft },
        { 'x-csrf-token': 'new-session-token' },
      ),
    )
    expect(nextSave.status).toBe(200)
    expect((await new ContentStore(tempRoot).read()).data).toEqual(nextDraft)
  })
})
