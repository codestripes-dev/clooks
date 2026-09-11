import { randomBytes, createHash } from 'node:crypto'
import { open, rename, unlink, lstat, realpath } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { validateContent, saveSchema } from './content-schema'
import { pageAssets, readSafe, sharedComponentsSource, websiteRoot } from './page-assets'

export const MAX_SAVE_BYTES = 256 * 1024
const revisionOf = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

export class ContentStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    readonly root = websiteRoot,
    readonly relative = 'page/content.json',
  ) {}
  async read() {
    const bytes = await readSafe(this.root, this.relative)
    return { data: validateContent(JSON.parse(bytes.toString())), revision: revisionOf(bytes) }
  }
  save(revision: string, data: unknown) {
    const operation = this.queue.then(async () => {
      const valid = validateContent(data)
      const current = await this.read()
      if (revision !== current.revision)
        throw new HttpError(
          409,
          'The content changed on disk. Reload the editor before saving; your draft is still in this tab.',
        )
      const path = join(await realpath(this.root), this.relative)
      const directory = dirname(path)
      if ((await lstat(directory)).isSymbolicLink()) throw new Error('Symlinks are not allowed')
      const temporary = join(directory, `.content-${randomBytes(16).toString('hex')}.tmp`)
      const bytes = JSON.stringify(valid, null, 2) + '\n'
      const file = await open(temporary, 'wx', 0o600)
      try {
        await file.writeFile(bytes)
        await file.sync()
        await file.close()
        // Catch external edits made while preparing the atomic replacement.
        if ((await this.read()).revision !== revision)
          throw new HttpError(409, 'The content changed on disk. Reload before saving.')
        await rename(temporary, path)
      } finally {
        await file.close().catch(() => {})
        await unlink(temporary).catch(() => {})
      }
      return { revision: revisionOf(bytes), data: valid }
    })
    this.queue = operation.catch(() => {})
    return operation
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function readBoundedJson(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_SAVE_BYTES))
    throw new HttpError(413, 'Save is too large')
  if (!request.body) throw new HttpError(400, 'Missing JSON body')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new HttpError(408, 'Save timed out'))
      void reader.cancel()
    }, 10_000)
  })
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout])
      if (timedOut) throw new HttpError(408, 'Save timed out')
      if (done) break
      total += value.byteLength
      if (total > MAX_SAVE_BYTES) {
        void reader.cancel()
        throw new HttpError(413, 'Save is too large')
      }
      chunks.push(value)
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new HttpError(400, 'Invalid JSON')
    }
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

type Asset = { body: Uint8Array | string; type: string }
export function createHandler(options: {
  origin: () => string
  token: string
  store: ContentStore
  assets: Map<string, Asset>
}) {
  const respond = (body: BodyInit | null, status = 200, type = 'application/json') =>
    new Response(body, {
      status,
      headers: {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
      },
    })
  const json = (value: unknown, status = 200) => respond(JSON.stringify(value), status)
  return async (request: Request) => {
    try {
      const url = new URL(request.url),
        origin = options.origin()
      if (request.headers.get('host') !== new URL(origin).host || url.origin !== origin)
        throw new HttpError(403, 'Invalid Host')
      const suppliedOrigin = request.headers.get('origin')
      if (
        (suppliedOrigin !== null && suppliedOrigin !== origin) ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      )
        throw new HttpError(403, 'Invalid Origin')
      // Exact route lookup only: never convert a request path into a filesystem path.
      if (url.search || /[%\\]/.test(url.pathname)) throw new HttpError(404, 'Not found')
      if (url.pathname === '/api/content') {
        if (request.method === 'GET')
          return json({ ...(await options.store.read()), csrf: options.token })
        if (request.method !== 'PUT') throw new HttpError(405, 'Method not allowed')
        if (suppliedOrigin !== origin || request.headers.get('x-csrf-token') !== options.token)
          throw new HttpError(403, 'Invalid save token or Origin')
        if (
          !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
            request.headers.get('content-type') ?? '',
          )
        )
          throw new HttpError(415, 'Expected application/json')
        const envelope = saveSchema.parse(await readBoundedJson(request))
        validateContent(envelope.data)
        return json(await options.store.save(envelope.revision, envelope.data))
      }
      if (url.pathname === '/content.json') {
        if (request.method !== 'GET' && request.method !== 'HEAD')
          throw new HttpError(405, 'Method not allowed')
        const { data } = await options.store.read()
        return request.method === 'HEAD' ? respond(null) : json(data)
      }
      const asset = options.assets.get(url.pathname)
      if (!asset) throw new HttpError(404, 'Not found')
      if (request.method !== 'GET' && request.method !== 'HEAD')
        throw new HttpError(405, 'Method not allowed')
      return respond(request.method === 'HEAD' ? null : (asset.body as BodyInit), 200, asset.type)
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status)
      if (error instanceof Error && error.name === 'ZodError')
        return json({ error: 'Invalid content: ' + error.message }, 400)
      // Validation errors are useful; filesystem paths and internal errors are not exposed.
      if (error instanceof Error && error.message.startsWith('Each section'))
        return json({ error: error.message }, 400)
      console.error('Website editor request failed:', error)
      return json(
        { error: 'Unable to read or save website content. Check the server terminal.' },
        500,
      )
    }
  }
}

export async function startEditor(port = 0, options: { store?: ContentStore } = {}) {
  const assets = await pageAssets()
  const shared = await sharedComponentsSource()
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, 'editor.tsx')],
    target: 'browser',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'shared-site',
        setup(builder) {
          builder.onResolve({ filter: /^clooks:site$/ }, () => ({
            path: 'site',
            namespace: 'clooks',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'clooks' }, () => ({
            contents: shared,
            loader: 'jsx',
            resolveDir: websiteRoot,
          }))
        },
      },
    ],
  })
  if (!build.success) throw new Error(build.logs.join('\n'))
  for (const output of build.outputs)
    assets.set('/editor-assets/' + output.path.split('/').pop(), {
      body: new Uint8Array(await output.arrayBuffer()),
      type: output.type,
    })
  const template = (await readSafe(websiteRoot, 'page/index.html')).toString()
  const pageCss = template.match(/<style>([\s\S]*?)<\/style>/)?.[1]
  if (!pageCss) throw new Error('Missing website styles')
  assets.set('/page-preview.css', { body: pageCss, type: 'text/css' })
  assets.set('/editor', {
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clooks website editor</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/editor-assets/editor.css"></head><body style="margin:0"><div id="editor"></div><script src="/version.js"></script><script type="module" src="/editor-assets/editor.js"></script></body></html>',
    type: 'text/html; charset=utf-8',
  })
  const store = options.store ?? new ContentStore()
  await store.read()
  let origin = ''
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    maxRequestBodySize: MAX_SAVE_BYTES,
    idleTimeout: 15,
    fetch: createHandler({
      origin: () => origin,
      token: randomBytes(32).toString('hex'),
      store,
      assets,
    }),
  })
  origin = `http://127.0.0.1:${server.port}`
  console.log(
    `Clooks website editor: ${origin}/editor\nSaved website: ${origin}/\nOnly page/content.json is writable through the editor.`,
  )
  return server
}

if (import.meta.main) {
  const requested = process.env.PAGE_EDITOR_PORT
  if (requested && (!/^\d+$/.test(requested) || Number(requested) > 65535))
    throw new Error('PAGE_EDITOR_PORT must be 0–65535')
  await startEditor(Number(requested ?? 0))
}
