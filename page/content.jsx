// Shared by the ordinary site and the local editor. No Puck dependency.
const PageEnvironment = React.createContext({ editing: false, targetWindow: null });
const PageSettings = React.createContext(null);
function usePageEnvironment() { return React.useContext(PageEnvironment); }

// Deliberately small inline-copy syntax: no HTML or executable content.
function Copy({ text, heading = false, danger = false }) {
  return String(text).split(/(\n|`[^`]+`|\[muted\][\s\S]*?\[\/muted\]|\*[^*]+\*|\[[^\]]+\]\([^\s)]+\))/g).map((part, i) => {
    if (part === '\n') return <br key={i}/>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: heading ? '0.85em' : undefined, color: danger ? COL.red : COL.fg, background: danger ? 'rgba(248,113,113,0.08)' : undefined, padding: danger ? '2px 8px' : undefined }}>{part.slice(1, -1)}</code>;
    if (part.startsWith('[muted]') && part.endsWith('[/muted]')) return <span key={i} style={{ color: COL.fgMute }}>{part.slice(7, -8)}</span>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i} style={{ color: COL.fgMute }}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link && /^(https?:\/\/|#[a-z])/i.test(link[2])) return <a key={i} href={link[2]}>{link[1]}</a>;
    return part;
  });
}

function SiteSection({ type, content }) {
  const tweaks = React.useContext(PageSettings);
  if (!content.visible) return null;
  const components = { Hero: tweaks.heroVariant === 'split' ? HeroSplit : HeroCode, Problem: ProblemSection, HookInAction: HookInActionSection, HookAnatomy: HookAnatomySection, Captures: CapturesSection, Config: ConfigSection, Ordering: OrderingSection, ScopedConfig: ScopedConfigSection, TmuxHook: TmuxHookSection, Comparison: ComparisonSection, Install: InstallSection, WhyNotPlugin: WhyNotPluginSection, FAQ: FAQSection, Footer };
  const Component = components[type];
  return <Component accent={tweaks.accent} tweaks={tweaks} content={content}/>;
}

function SiteRoot({ settings, children }) {
  return <PageSettings.Provider value={settings}><ViewportFrame sim="full"><Nav accent={settings.accent}/>{children}</ViewportFrame></PageSettings.Provider>;
}

function Site({ data }) {
  return <SiteRoot settings={data.root.props}>{data.content.map(item => <SiteSection key={item.props.id} type={item.type} content={item.props}/>)}</SiteRoot>;
}

function applyPageMetadata(metadata) {
  document.querySelectorAll('[data-page-meta]').forEach(el => el.remove());
  document.title = metadata.title;
  const meta = (key, value, property = false) => {
    if (!value) return;
    const el = document.createElement('meta');
    el.setAttribute(property ? 'property' : 'name', key);
    el.content = value;
    el.dataset.pageMeta = '';
    document.head.appendChild(el);
  };
  meta('description', metadata.description);
  meta('og:type', 'website', true);
  for (const [key, value] of Object.entries({ title: metadata.title, description: metadata.description, url: metadata.canonical, image: metadata.image })) meta('og:' + key, value, true);
  for (const [key, value] of Object.entries({ title: metadata.title, description: metadata.description, image: metadata.image, card: metadata.image ? 'summary_large_image' : 'summary' })) meta('twitter:' + key, value);
  if (metadata.image) { meta('og:image:width', '1200', true); meta('og:image:height', '630', true); }
  if (metadata.canonical) {
    const el = document.createElement('link'); el.rel = 'canonical'; el.href = metadata.canonical; el.dataset.pageMeta = ''; document.head.appendChild(el);
  }
  const ld = document.createElement('script');
  ld.type = 'application/ld+json'; ld.dataset.pageMeta = '';
  ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Clooks', ...(metadata.description ? { description: metadata.description } : {}), ...(metadata.canonical ? { url: metadata.canonical } : {}), applicationCategory: 'DeveloperApplication', operatingSystem: 'macOS, Linux', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } }).replace(/</g, '\\u003c');
  document.head.appendChild(ld);
}
