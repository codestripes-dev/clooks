function RoadmapSection({ accent }) {
  const items = [
    { k: 'Claude Code', status: 'shipping', note: 'primary target, working today' },
    { k: 'clooks test', status: 'wip', note: 'runner in progress — co-located .test.ts files today' },
    { k: 'clooks manage (TUI)', status: 'planned', note: 'interactive marketplace browser' },
    { k: 'Prebuilt binaries', status: 'shipping', note: 'GitHub releases for darwin/linux, arm64 + x64' },
    { k: 'Cursor', status: 'planned', note: 'event mapping researched' },
    { k: 'Codex', status: 'planned', note: 'event mapping researched' },
    { k: 'OpenCode', status: 'planned', note: 'event mapping researched' },
    { k: 'OpenClaw', status: 'planned', note: 'event mapping researched' },
  ];
  const vp = useViewport();
  const cols = vp.isMobile ? 1 : vp.isTablet ? 2 : 3;
  const color = (s) =>
    s === 'shipping' ? COL.green :
    s === 'wip' ? accent :
    s === 'planned' ? COL.fgMute :
    COL.fgFaint;
  return (
    <section className="section section--elev">
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Roadmap</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 40px', maxWidth: 640,
        }}>
          Where things stand at <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85em' }}>v{window.CLOOKS_VERSION}</code>.
        </h2>
        <div style={{
          display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 0,
          border: `1px solid ${COL.line}`,
        }}>
          {items.map((it, i) => {
            const rem = items.length % cols || cols;
            return (
            <div key={it.k} style={{
              padding: '22px 24px',
              borderRight: i % cols !== cols - 1 ? `1px solid ${COL.line}` : 'none',
              borderBottom: i < items.length - rem ? `1px solid ${COL.line}` : 'none',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
              }}>
                <span style={{
                  width: 7, height: 7, background: color(it.status),
                  display: 'inline-block', borderRadius: it.status === 'deferred' ? 0 : '50%',
                }}/>
                <span style={{
                  fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase',
                  color: color(it.status), fontFamily: 'JetBrains Mono, monospace',
                }}>{it.status}</span>
              </div>
              <div style={{ fontSize: 15, color: COL.fg, marginBottom: 4, fontWeight: 500 }}>{it.k}</div>
              <div style={{ fontSize: 13, color: COL.fgMute, lineHeight: 1.5 }}>{it.note}</div>
            </div>
          );
          })}
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { RoadmapSection });
