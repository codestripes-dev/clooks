function Footer({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile;
  return (
    <footer style={{ padding: stack ? '48px 18px 32px' : '60px 32px 40px' }}>
      <div style={{
        maxWidth: 1120, margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: stack ? '1fr 1fr' : vp.isTablet ? '1fr 1fr' : '2fr 1fr 1fr',
        gap: stack ? 28 : 40,
      }}>
        <div style={{ gridColumn: stack ? '1 / -1' : 'auto' }}>
          <Logo accent={accent}/>
          <p style={{ fontSize: 13, color: COL.fgMute, marginTop: 14, maxWidth: 300, lineHeight: 1.5 }}>
            A TypeScript hook runtime for Claude Code. Open source under MIT.
          </p>
          <div style={{
            marginTop: 20, fontSize: 11, color: COL.fgFaint,
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            clooks v{window.CLOOKS_VERSION} · built with bun
          </div>
        </div>
        {[
          { h: 'Project', links: [
            ['GitHub', 'https://github.com/codestripes-dev/clooks'],
            ['Marketplace', 'https://github.com/codestripes-dev/clooks-marketplace'],
            ['Core hooks', '#'],
            ['Project hooks', '#'],
          ]},
          { h: 'Docs', links: [
            ['Install', '#install'],
            ['Hook API', '#hook'],
            ['Config', '#config'],
            ['FAQ', '#faq'],
          ]},
        ].map(col => (
          <div key={col.h}>
            <div style={{
              fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
              color: COL.fgDim, marginBottom: 14,
            }}>{col.h}</div>
            {col.links.map(([label, href]) => (
              <a key={label} href={href} style={{
                display: 'block', fontSize: 13, color: COL.fg,
                textDecoration: 'none', padding: '4px 0',
              }}>{label}</a>
            ))}
          </div>
        ))}
      </div>
      <div style={{
        maxWidth: 1120, margin: '64px auto 0', padding: '24px 0 0',
        borderTop: `1px solid ${COL.line}`,
        display: 'flex', justifyContent: 'space-between',
        fontSize: 12, color: COL.fgDim, fontFamily: 'JetBrains Mono, monospace',
        gap: 16, flexWrap: 'wrap',
      }}>
        <span>MIT License · joe@clooks.cc</span>
        <span>© {new Date().getFullYear()} Codestripes</span>
      </div>
    </footer>
  );
}

Object.assign(window, { Footer });
