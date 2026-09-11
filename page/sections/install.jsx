function InstallSection({ accent, tweaks, content }) {
  const vp = useViewport();
  const { targetWindow } = usePageEnvironment();
  const win = targetWindow || window;
  const stack = vp.isMobile;
  const [path, setPath] = React.useState(() => {
    const route = win.location.hash.replace('#install-', '');
    return ['claude', 'codex', 'binary'].includes(route) ? route : 'codex';
  });
  React.useEffect(() => {
    const selectRoute = () => {
      const route = win.location.hash.replace('#install-', '');
      if (['claude', 'codex', 'binary'].includes(route)) setPath(route);
    };
    win.addEventListener('hashchange', selectRoute);
    return () => win.removeEventListener('hashchange', selectRoute);
  }, [win]);

  const paths = Object.fromEntries(content.paths.map(p => [p.id, p]));

  const active = paths[path];

  return (
    <section id="install" className="section section--elev">
      <span id="install-claude"/><span id="install-codex"/><span id="install-binary"/>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>{content.label}</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 780,
        }}>
          <Copy text={content.title} heading/>
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 28px', lineHeight: 1.6 }}>
          <Copy text={content.intro}/>
        </p>

        <div style={{
          display: 'flex', gap: 0, marginBottom: 0,
          borderBottom: `1px solid ${COL.line}`,
        }}>
          {Object.entries(paths).map(([key, p]) => (
            <button key={key} onClick={() => {
              setPath(key);
              // srcdoc inherits the editor's base URL. Resolve against the
              // preview's own URL so its hash never targets the editor page.
              const url = new URL(win.location.href);
              url.hash = `install-${key}`;
              win.history.replaceState(null, '', url.href);
            }} aria-pressed={path === key} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: vp.isMobile ? '10px 8px 12px' : '12px 20px 14px',
              fontSize: vp.isMobile ? 12 : 13, fontFamily: 'inherit',
              whiteSpace: 'normal',
              color: path === key ? COL.fg : COL.fgMute,
              borderBottom: `2px solid ${path === key ? accent : 'transparent'}`,
              marginBottom: -1,
              flex: vp.isMobile ? '1 1 0' : '0 0 auto',
              textAlign: vp.isMobile ? 'center' : 'left',
              minWidth: 0,
            }}>{p.label}</button>
          ))}
        </div>

        <p style={{
          fontSize: 14, color: COL.fgMute, lineHeight: 1.6, maxWidth: 720,
          margin: '28px 0 28px',
        }}>{active.blurb}</p>

        <div style={{ display: 'grid', gap: 0 }}>
          {active.steps.map((s, i) => (
            <div key={`${path}-${i}`} style={{
              display: 'grid',
              gridTemplateColumns: stack ? '40px minmax(0, 1fr)' : vp.isTablet ? '50px minmax(0, 1fr)' : '64px minmax(0, 1fr) minmax(0, 1.2fr)',
              gap: stack ? 16 : vp.isTablet ? 24 : 40,
              padding: stack ? '22px 0' : '28px 0', borderTop: `1px solid ${COL.line}`,
              alignItems: 'start',
            }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
                color: accent, paddingTop: 4,
              }}>
                0{i + 1}
              </div>
              <div style={{ gridColumn: stack || vp.isTablet ? 'auto' : undefined, minWidth: 0 }}>
                <div style={{ fontSize: stack ? 16 : 17, fontWeight: 500, color: COL.fg, marginBottom: 8, letterSpacing: -0.2 }}>
                  {s.t}
                </div>
                <div style={{ fontSize: 14, color: COL.fgMute, lineHeight: 1.55, maxWidth: 440 }}>
                  <Copy text={s.d}/>
                </div>
                {(stack || vp.isTablet) && (
                  <div style={{ marginTop: 14 }}>
                    <CmdBox accent={accent} cmd={s.cmd} slash={s.slash} comment={s.comment} copyLabel={`Copy ${active.label}: ${s.t}`}/>
                  </div>
                )}
              </div>
              {!stack && !vp.isTablet && (
                <div style={{ alignSelf: 'center', minWidth: 0 }}>
                  <CmdBox accent={accent} cmd={s.cmd} slash={s.slash} comment={s.comment} copyLabel={`Copy ${active.label}: ${s.t}`}/>
                </div>
              )}
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${COL.line}` }}/>
        </div>

        <div style={{
          marginTop: 40, padding: '20px 24px',
          background: COL.bgSoft, border: `1px solid ${COL.line}`,
          display: 'grid',
          gridTemplateColumns: stack ? '1fr' : 'auto 1fr',
          gap: stack ? 10 : 20, alignItems: 'start',
        }}>
          <span style={{
            color: accent, fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', paddingTop: 2,
            whiteSpace: 'nowrap',
          }}>{content.notesLabel}</span>
          <div style={{ fontSize: 14, color: COL.fgMute, lineHeight: 1.65 }}>
            {content.notes.map((note, i) => <p key={i} style={{ margin: i === content.notes.length - 1 ? 0 : '0 0 12px' }}><Copy text={note.text}/></p>)}
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { InstallSection });
