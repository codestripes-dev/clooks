import { z } from 'zod'

const text = z.string().max(12_000)
const short = z.string().max(500)
const href = short.refine(
  (value) => /^(#[a-z][a-z0-9-]*|https?:\/\/[^\s]+)$/i.test(value),
  'Use an anchor or an http(s) URL',
)
const optionalUrl = short.refine(
  (value) => value === '' || /^https?:\/\/[^\s]+$/i.test(value),
  'Use an http(s) URL, or leave empty to remove',
)
export const rootSchema = z.strictObject({
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  heroVariant: z.enum(['split', 'code']),
  metadata: z.strictObject({
    title: short.min(1),
    description: text,
    canonical: optionalUrl,
    image: optionalUrl,
  }),
})
const base = { id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), visible: z.boolean() }
const heading = { ...base, label: short, title: text }
const intro = { ...heading, intro: text }
const demo = z.strictObject({ title: text, intro: text })
const note = z.strictObject({ text })
const step = z.strictObject({ t: short, cmd: text, d: text, slash: z.boolean() })
const path = z.strictObject({
  id: z.enum(['claude', 'codex', 'binary']),
  label: short,
  blurb: text,
  steps: z.array(step).min(1).max(20),
})
export const propsSchemas = {
  Hero: z.strictObject({
    ...base,
    title: short,
    subtitle: short,
    intro: text,
    links: z.array(z.strictObject({ label: short, href })).max(8),
    terminalTitle: short,
    copyLabel: short,
    commands: z
      .array(z.strictObject({ cmd: text.min(1), output: text, doneLabel: short }))
      .min(1)
      .max(8),
    setupIntro: text,
    setupCommand: text,
    setupNote: text,
    badges: z.array(note).max(8),
    snippetLabel: short,
  }),
  Problem: z.strictObject({
    ...intro,
    pains: z.array(z.strictObject({ n: short, k: short, d: text })).max(12),
  }),
  HookInAction: z.strictObject(intro),
  HookAnatomy: z.strictObject(intro),
  Captures: z.strictObject(intro),
  Config: z.strictObject(intro),
  Ordering: z.strictObject(heading),
  ScopedConfig: z.strictObject(intro),
  TmuxHook: z.strictObject({ ...base, label: short, pkg: demo, mv: demo, tmux: demo }),
  Comparison: z.strictObject(heading),
  Install: z.strictObject({
    ...intro,
    paths: z
      .array(path)
      .length(3)
      .refine(
        (paths) => new Set(paths.map((p) => p.id)).size === 3,
        'Keep one of each installation path',
      ),
    notesLabel: short,
    notes: z.array(note).max(12),
  }),
  WhyNotPlugin: z.strictObject({ ...intro, setup: text }),
  FAQ: z.strictObject({
    ...heading,
    faqs: z
      .array(z.strictObject({ q: short.min(1), a: text.min(1) }))
      .min(1)
      .max(40),
  }),
  Footer: z.strictObject({
    ...base,
    intro: text,
    builtWith: short,
    license: short,
    copyright: short,
    columns: z
      .array(
        z.strictObject({
          label: short,
          links: z.array(z.strictObject({ label: short, href })).max(8),
        }),
      )
      .max(4),
  }),
}
export type SectionType = keyof typeof propsSchemas
export type SectionProps = { [K in SectionType]: z.infer<(typeof propsSchemas)[K]> }
export type RootProps = z.infer<typeof rootSchema>
export type ContentItem = { [K in SectionType]: { type: K; props: SectionProps[K] } }[SectionType]
export type PageData = { root: { props: RootProps }; content: ContentItem[] }
const envelope = z.strictObject({
  root: z.strictObject({ props: rootSchema }),
  content: z
    .array(
      z.strictObject({
        type: z.enum(Object.keys(propsSchemas) as [SectionType, ...SectionType[]]),
        props: z.unknown(),
      }),
    )
    .length(Object.keys(propsSchemas).length),
})

export function validateContent(value: unknown): PageData {
  const data = envelope.parse(value)
  const ids = new Set<string>(),
    types = new Set<string>()
  for (const item of data.content) {
    const props = propsSchemas[item.type].parse(item.props)
    if (ids.has(props.id) || types.has(item.type))
      throw new Error(
        'Each section and ID must occur exactly once; use visibility to hide a section',
      )
    ids.add(props.id)
    types.add(item.type)
    item.props = props
  }
  return data as PageData
}

export const saveSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  data: z.unknown(),
})
