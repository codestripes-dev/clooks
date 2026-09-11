import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Puck, usePuck, type Config, type Field, type Data as PuckData, type Viewports } from '@puckeditor/core'
import '@puckeditor/core/puck.css'
import './editor.css'
import defaults from '../page/content.json'
import { SiteRoot, SiteSection, PageEnvironment } from 'clooks:site'
import { validateContent, type PageData, type RootProps, type SectionProps, type SectionType } from './content-schema'

type Data = PuckData<Record<string, Record<string, unknown>>, Record<string, unknown>>

const labels: Record<string, string> = { visible: 'Visible on website', title: 'Heading', subtitle: 'Muted heading', intro: 'Introduction', label: 'Label', links: 'Setup links / CTAs', href: 'Link destination', terminalTitle: 'Terminal title', copyLabel: 'Copy button label', commands: 'Hero terminal commands', cmd: 'Command', output: 'Command output', doneLabel: 'Completion label', setupIntro: 'Setup instruction', setupCommand: 'Setup command', setupNote: 'Setup note', badges: 'Platform / license badges', snippetLabel: 'Code example label (stacked hero)', pains: 'Problem cards', n: 'Number', k: 'Card heading', d: 'Description', t: 'Step title', slash: 'Agent instruction (no shell prompt)', paths: 'Installation paths', blurb: 'Path description', steps: 'Steps', notes: 'Installation notes', notesLabel: 'Notes label', setup: 'Setup details', faqs: 'Questions and answers', q: 'Question', a: 'Answer', text: 'Text', accent: 'Accent color (#RRGGBB)', heroVariant: 'Hero layout', metadata: 'Search and social metadata', description: 'Description (empty removes)', canonical: 'Canonical URL (empty removes)', image: 'Social image URL (empty removes)' }

// Field structure must survive saving an empty optional array and restarting.
const arrayTemplates: Record<string, Record<string, unknown>> = {
  claude: { cmd: 'claude /clooks:setup', output: '', doneLabel: 'Done' },
  codex: { cmd: "codex '$clooks:setup'", output: '', doneLabel: 'Done' },
  links: { label: 'Link', href: '#install' },
  commands: { cmd: 'clooks --version', output: '', doneLabel: 'Done' },
  badges: { text: 'Badge' }, pains: { n: '01', k: 'Heading', d: '' },
  paths: { id: 'codex', label: 'Codex', blurb: '', steps: [] },
  steps: { t: 'Step', cmd: '', d: '', slash: false },
  notes: { text: 'Note' }, faqs: { q: 'New question', a: 'Answer' },
  columns: { label: 'Links', links: [] },
}

// Puck fields with native controls for color and visibility.
function fieldsFor(values: Record<string, unknown>): Record<string, Field> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'id').map(([key, value]) => {
    const label = labels[key] ?? key
    let field: Field
    if (key === 'accent') field = { type: 'custom', label, render: ({ value, onChange, id, readOnly }) => <label htmlFor={id}>{label}<input id={id} type="color" value={value} disabled={readOnly} onChange={event => onChange(event.target.value)}/></label> }
    else if (key === 'heroVariant') field = { type: 'select', label, options: [{ label: 'Split', value: 'split' }, { label: 'Stacked', value: 'code' }] }
    else if (typeof value === 'boolean') field = { type: 'custom', label, render: ({ value, onChange, id, readOnly }) => <label htmlFor={id}><input id={id} type="checkbox" checked={value} disabled={readOnly} onChange={event => onChange(event.target.checked)}/> {label}</label> }
    else if (Array.isArray(value)) field = { type: 'array', label, arrayFields: fieldsFor(arrayTemplates[key]), defaultItemProps: arrayTemplates[key], min: ['claude', 'codex', 'commands', 'steps', 'faqs'].includes(key) ? 1 : key === 'paths' ? 3 : 0, max: key === 'paths' ? 3 : key === 'faqs' ? 40 : key === 'steps' ? 20 : key === 'columns' ? 4 : ['claude', 'codex', 'commands', 'links', 'badges'].includes(key) ? 8 : 12, getItemSummary: item => String(item.label ?? item.q ?? item.t ?? item.k ?? item.cmd ?? item.text ?? 'Item').slice(0, 70) }
    else if (value !== null && typeof value === 'object') field = { type: 'object', label, objectFields: fieldsFor(value as Record<string, unknown>) }
    else field = { type: ['intro', 'title', 'blurb', 'd', 'a', 'cmd', 'setup', 'setupNote', 'setupIntro', 'description', 'text'].includes(key) ? 'textarea' : 'text', label }
    return [key, field]
  }))
}

const initial = validateContent(defaults)
const components: Config['components'] = Object.fromEntries(initial.content.map(item => [item.type, {
  label: item.type.replace(/([a-z])([A-Z])/g, '$1 $2'),
  fields: fieldsFor(item.props),
  defaultProps: item.props,
  render: (props: Record<string, unknown>) => props.visible
    ? <SiteSection type={item.type} content={props as SectionProps[SectionType]}/>
    : <div style={{ padding: 20, background: '#171717', color: '#a1a1aa', border: '1px dashed #555', fontFamily: 'sans-serif' }}>Hidden: {item.type} — select to show again</div>,
}]))

const config: Config = {
  root: { fields: fieldsFor(initial.root.props), render: ({ children, ...settings }: Record<string, unknown> & { children?: React.ReactNode }) => <SiteRoot settings={settings as RootProps}>{children}</SiteRoot> },
  components,
}

function PreviewFrame({ children }: { children: React.ReactNode; document?: Document }) {
  const [frameDocument, setFrameDocument] = useState<Document | null>(null)
  const mount = React.useCallback((element: HTMLDivElement | null) => {
    if (element) setFrameDocument(element.ownerDocument)
  }, [])
  const environment = useMemo(() => ({ editing: true, targetWindow: frameDocument?.defaultView ?? null }), [frameDocument])
  // Puck synchronizes the iframe head. Keep our styles in its React-owned body
  // so a later head sync cannot remove them.
  return <div ref={mount}><link rel="stylesheet" href="/vendor/fonts/fonts.css"/><link rel="stylesheet" href="/page-preview.css"/><PageEnvironment.Provider value={environment}>{frameDocument ? children : null}</PageEnvironment.Provider></div>
}

// Puck owns transient editor state (including zones). Persist only our document.
function persisted(data: Data): PageData { return validateContent({ root: data.root, content: data.content }) }
const serialize = (data: PageData) => JSON.stringify(data)
type Loaded = { data: PageData; revision: string; csrf: string }
// Puck's viewport initialization also seeds history. These identities must not
// change when the parent updates dirty/saving status.
const editorViewports: Viewports = [{ width: 1280, label: 'Desktop', icon: 'Monitor' }, { width: 390, label: 'Mobile', icon: 'Smartphone' }]
const editorIframe = { enabled: true }
const editorUi = { plugin: { current: 'outline' } }
const editorPermissions = { insert: false, duplicate: false, delete: false }

function Editor({ loaded }: { loaded: Loaded }) {
  const [saved, setSaved] = useState(serialize(loaded.data))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('Saved')
  const revision = useRef(loaded.revision)
  const inFlight = useRef(false)
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save(data: Data) {
    if (inFlight.current) return
    try {
      const snapshot = persisted(data)
      inFlight.current = true; setSaving(true); setMessage('Saving…')
      const response = await fetch('/api/content', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': loaded.csrf }, body: JSON.stringify({ revision: revision.current, data: snapshot }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Save failed')
      revision.current = result.revision
      setSaved(serialize(snapshot)); setMessage('Saved')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed') }
    finally { inFlight.current = false; setSaving(false) }
  }

  // Stable component identity keeps the Puck toolbar and its focus intact.
  const state = useRef({ saved, saving, message, save })
  state.current = { saved, saving, message, save }
  const onPublish = React.useCallback((data: Data) => { void state.current.save(data) }, [])
  const HeaderActions = useMemo(() => function Actions() {
    const { appState, dispatch } = usePuck()
    const selected = appState.ui.itemSelector?.index
    let clean = false
    try { clean = serialize(persisted(appState.data)) === state.current.saved } catch { /* Show validation on Save. */ }
    useEffect(() => { setDirty(!clean) }, [clean])
    return <div className="editor-actions">
      <button aria-pressed={appState.ui.previewMode === 'interactive'} onClick={() => dispatch({ type: 'setUi', ui: { previewMode: appState.ui.previewMode === 'interactive' ? 'edit' : 'interactive' } })}>Interact with preview</button>
      {selected !== undefined && <>
        <button title="Move section up" disabled={selected === 0} onClick={() => dispatch({ type: 'reorder', sourceIndex: selected, destinationIndex: selected - 1, destinationZone: 'root:default-zone' })}>Move up</button>
        <button title="Move section down" disabled={selected === appState.data.content.length - 1} onClick={() => dispatch({ type: 'reorder', sourceIndex: selected, destinationIndex: selected + 1, destinationZone: 'root:default-zone' })}>Move down</button>
      </>}
      <span role="status" className="save-status">{state.current.saving ? 'Saving…' : state.current.message === 'Saved' ? (clean ? 'Saved' : 'Unsaved changes') : state.current.message}</span>
      <a href="/" target="_blank" rel="noreferrer">Saved website ↗</a>
      <button onClick={() => {
        const blob = new Blob([JSON.stringify({ root: appState.data.root, content: appState.data.content }, null, 2) + '\n'], { type: 'application/json' })
        const href = URL.createObjectURL(blob), link = document.createElement('a'); link.href = href; link.download = 'clooks-content-draft.json'; link.click(); URL.revokeObjectURL(href)
      }}>Export draft</button>
      <button className="save-button" disabled={clean || state.current.saving} onClick={() => onPublish(appState.data)}>Save</button>
    </div>
  }, [])

  const overrides = useMemo(() => ({ iframe: PreviewFrame, headerActions: HeaderActions }), [HeaderActions])
  return <Puck config={config} data={loaded.data} ui={editorUi} onPublish={onPublish} headerTitle="Clooks website" headerPath="Local editor" height="100vh" permissions={editorPermissions} viewports={editorViewports} iframe={editorIframe} overrides={overrides}/>
}

async function main() {
  const root = createRoot(document.getElementById('editor')!)
  try {
    const response = await fetch('/api/content')
    if (!response.ok) throw new Error('Unable to load website content')
    const loaded: Loaded = await response.json()
    loaded.data = validateContent(loaded.data)
    root.render(<Editor loaded={loaded}/>)
  } catch (error) { root.render(<p role="alert">{String(error)}. Check the server terminal, then reload.</p>) }
}
void main()
