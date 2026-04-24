function ScopedConfigSection({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;
  const mono = { fontFamily: 'JetBrains Mono, monospace' };

  const layers = [
    {
      badge: 'HOME',
      badgeColor: COL.fgMute,
      path: '~/.clooks/clooks.yml',
      caption: <>Machine-wide defaults plus your personal tooling.</>,
      lines: [
        [[TK.prop, 'config'], [TK.op, ':']],
        ['  ', [TK.prop, 'timeout'], [TK.op, ': '], [TK.num, '30000']],
        ['  ', [TK.prop, 'onError'], [TK.op, ': '], [TK.str, 'block']],
        '',
        [[TK.prop, 'no-bare-mv'], [TK.op, ': {}']],
      ],
    },
    {
      badge: 'PROJECT',
      badgeColor: accent,
      path: '.clooks/clooks.yml',
      caption: <>Committed. Team picks a package manager and pins a shared secret scanner.</>,
      lines: [
        [[TK.prop, 'js-package-manager-guard'], [TK.op, ':']],
        ['  ', [TK.prop, 'config'], [TK.op, ':']],
        ['    ', [TK.prop, 'allowed'], [TK.op, ': ['], [TK.str, '"pnpm"'], [TK.op, ']']],
        '',
        [[TK.prop, 'secret-scanner'], [TK.op, ':']],
        ['  ', [TK.prop, 'uses'], [TK.op, ': '], [TK.str, 'no-public-secrets']],
      ],
    },
    {
      badge: 'LOCAL',
      badgeColor: COL.green,
      path: '.clooks/clooks.local.yml',
      caption: <>Gitignored. Loosen a team rule or mute a hook just for you.</>,
      lines: [
        [[TK.prop, 'js-package-manager-guard'], [TK.op, ':']],
        ['  ', [TK.prop, 'config'], [TK.op, ':']],
        ['    ', [TK.prop, 'allowed'], [TK.op, ': ['], [TK.str, '"pnpm"'], [TK.op, ', '], [TK.str, '"npm"'], [TK.op, ']']],
        '',
        [[TK.prop, 'secret-scanner'], [TK.op, ':']],
        ['  ', [TK.prop, 'enabled'], [TK.op, ': '], [TK.kw, 'false']],
      ],
    },
  ];

  const resolvedLines = [
    [[TK.prop, 'config'], [TK.op, ':']],
    ['  ', [TK.prop, 'timeout'], [TK.op, ': '], [TK.num, '30000']],
    ['  ', [TK.prop, 'onError'], [TK.op, ': '], [TK.str, 'block']],
    '',
    [[TK.prop, 'no-bare-mv'], [TK.op, ': {}']],
    '',
    [[TK.prop, 'js-package-manager-guard'], [TK.op, ':']],
    ['  ', [TK.prop, 'config'], [TK.op, ':']],
    ['    ', [TK.prop, 'allowed'], [TK.op, ': ['], [TK.str, '"pnpm"'], [TK.op, ', '], [TK.str, '"npm"'], [TK.op, ']']],
    '',
    [[TK.prop, 'secret-scanner'], [TK.op, ':']],
    ['  ', [TK.prop, 'uses'], [TK.op, ': '], [TK.str, 'no-public-secrets']],
    ['  ', [TK.prop, 'enabled'], [TK.op, ': '], [TK.kw, 'false']],
  ];

  const maxLines = Math.max(...layers.map((l) => l.lines.length));
  const padLines = (lines) => [
    ...lines,
    ...Array(Math.max(0, maxLines - lines.length)).fill(''),
  ];

  // Which resolved lines each layer contributes to. A layer "contributes" to a line
  // when its config touches that key or value in the merged tree. Shared keys
  // (6, 7, 10) appear under both PROJECT and LOCAL because both declare the hook.
  // Line 8 is LOCAL-only because its rendered value is LOCAL's (PROJECT's was overridden).
  const LAYER_LINES = {
    HOME:    [0, 1, 2, 4],
    PROJECT: [6, 7, 10, 11],
    LOCAL:   [6, 7, 8, 10, 12],
  };
  const layerColor = { HOME: COL.fgMute, PROJECT: accent, LOCAL: COL.green };
  const [hoveredLayer, setHoveredLayer] = React.useState(null);
  const hlSet = new Set(hoveredLayer ? LAYER_LINES[hoveredLayer] : []);
  const hoverColor = hoveredLayer ? layerColor[hoveredLayer] : null;

  const ScopeCard = ({ layer }) => {
    const active = hoveredLayer === layer.badge;
    return (
      <div
        onMouseEnter={() => setHoveredLayer(layer.badge)}
        onMouseLeave={() => setHoveredLayer(null)}
        style={{
          minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10,
          padding: 10, margin: -10,
          borderLeft: `2px solid ${active ? layer.badgeColor : 'transparent'}`,
          background: active ? 'rgba(255,255,255,0.015)' : 'transparent',
          transition: 'background 180ms ease, border-color 180ms ease',
          cursor: 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{
            ...mono, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase',
            color: layer.badgeColor, border: `1px solid ${layer.badgeColor}`,
            padding: '3px 8px',
          }}>
            {layer.badge}
          </span>
          <span style={{ ...mono, fontSize: 12, color: COL.fg, wordBreak: 'break-all' }}>
            {layer.path}
          </span>
        </div>
        <CodeCard lines={padLines(layer.lines)} lineNumbers={false} compact/>
        <div style={{ fontSize: 12.5, color: COL.fgMute, lineHeight: 1.5 }}>
          {layer.caption}
        </div>
      </div>
    );
  };

  return (
    <section id="scoped-config" className="section">
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Scoped config</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 16px', maxWidth: 820,
        }}>
          Three files merge top-down.<br/>
          <span style={{ color: COL.fgMute }}>Last write wins.</span>
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 680, margin: '0 0 32px', lineHeight: 1.6 }}>
          Each layer adds its own hooks and can override the ones beneath. Personal defaults in home,
          team rules in the repo, and a gitignored local file for the exceptions only you need.
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: stack ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))',
          gap: stack ? 24 : 20,
        }}>
          {layers.map((layer) => <ScopeCard key={layer.badge} layer={layer}/>)}
        </div>

        <div style={{
          marginTop: 32, padding: '24px 0 0',
          borderTop: `1px solid ${COL.line}`,
          display: 'grid',
          gridTemplateColumns: stack ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 420px',
          gap: stack ? 20 : 48,
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, maxWidth: 460 }}>
            {[
              { badge: 'HOME', color: COL.fgMute, text: 'Hooks you always want, available in every repo.' },
              { badge: 'PROJECT', color: accent, text: 'Team-owned hooks committed with the repo.' },
              { badge: 'LOCAL', color: COL.green, text: 'Personal overrides that never leave your box.' },
            ].map((row) => {
              const active = hoveredLayer === row.badge;
              return (
                <div
                  key={row.badge}
                  onMouseEnter={() => setHoveredLayer(row.badge)}
                  onMouseLeave={() => setHoveredLayer(null)}
                  style={{
                    display: 'flex', gap: 14, alignItems: 'flex-start',
                    padding: '10px 12px', margin: '-2px -12px',
                    borderLeft: `2px solid ${active ? row.color : 'transparent'}`,
                    paddingLeft: active ? 10 : 12,
                    background: active ? 'rgba(255,255,255,0.025)' : 'transparent',
                    transition: 'background 180ms ease, border-color 180ms ease, padding 180ms ease',
                    cursor: 'default',
                  }}
                >
                  <span style={{
                    ...mono, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase',
                    color: row.color, border: `1px solid ${row.color}`,
                    padding: '3px 8px', flexShrink: 0,
                    minWidth: 72, textAlign: 'center',
                  }}>
                    {row.badge}
                  </span>
                  <span style={{ fontSize: 14, color: COL.fg, lineHeight: 1.55, paddingTop: 1 }}>
                    {row.text}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                ...mono, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase',
                color: COL.bg || '#0a0a0a', background: accent, padding: '3px 8px',
              }}>
                Resolved
              </span>
              <span style={{ fontSize: 12.5, color: COL.fgMute }}>
                {hoveredLayer
                  ? <>showing lines from <span style={{ color: hoverColor }}>{hoveredLayer}</span></>
                  : 'what Clooks sees'}
              </span>
            </div>
            <div style={{
              background: COL.bgCode, border: `1px solid ${COL.line}`,
              fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
              lineHeight: 1.65, overflow: 'hidden',
            }}>
              <div style={{ padding: '14px 0' }}>
                {resolvedLines.map((l, i) => {
                  const on = hlSet.has(i);
                  return (
                    <div key={i} style={{
                      whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                      minHeight: 12 * 1.65,
                      padding: '0 14px',
                      background: on ? `${hoverColor}22` : 'transparent',
                      borderLeft: `2px solid ${on ? hoverColor : 'transparent'}`,
                      paddingLeft: on ? 12 : 14,
                      transition: 'background 180ms ease, border-color 180ms ease',
                    }}>
                      {renderLine(l)}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { ScopedConfigSection });
