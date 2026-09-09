import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CapturedRequest {
  method: string
  path: string
  headers: Record<string, string>
  body: any
}

export function sse(id: string, item: unknown): string {
  return [
    { type: 'response.created', response: { id } },
    { type: 'response.output_item.done', item },
    {
      type: 'response.completed',
      response: {
        id,
        usage: {
          input_tokens: 0,
          input_tokens_details: null,
          output_tokens: 0,
          output_tokens_details: null,
          total_tokens: 0,
        },
      },
    },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
}

// Only assistant items are scripted. Tool outputs must arrive from the native client.
export function startFixture(items: unknown[], logs: string) {
  const requests: CapturedRequest[] = []
  const errors: string[] = []
  let consumed = 0
  let received = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const index = ++received
      const raw = Buffer.from(await request.arrayBuffer())
      let body: any = null
      try {
        body = JSON.parse(raw.toString())
      } catch {
        /* Raw bytes remain available. */
      }
      const record = {
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body,
      }
      requests.push(record)
      writeFileSync(join(logs, `request-${index}.body`), raw, { flag: 'wx' })
      writeFileSync(join(logs, `request-${index}.json`), JSON.stringify(record, null, 2) + '\n', {
        flag: 'wx',
      })
      const reject = (message: string, status: number) => {
        errors.push(message)
        return new Response(message, { status })
      }
      if (request.headers.has('authorization')) return reject('Unexpected auth', 400)
      if (record.method !== 'POST' || record.path !== '/v1/responses')
        return reject('Unexpected route', 404)
      if (!body || !Array.isArray(body.input) || request.headers.has('content-encoding'))
        return reject('Unexpected body', 400)
      if (consumed >= items.length) return reject('Script exhausted', 409)
      const wire = sse(`native_m1_response_${consumed + 1}`, items[consumed++])
      writeFileSync(join(logs, `response-${consumed}.sse`), wire, { flag: 'wx' })
      return new Response(wire, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  return {
    requests,
    errors,
    port: server.port,
    assertComplete() {
      if (errors.length || consumed !== items.length || requests.length !== items.length) {
        throw new Error(`Fixture sequence: ${consumed}/${items.length}; ${errors.join('; ')}`)
      }
    },
    stop: () => server.stop(true),
  }
}
