function OrderingSection({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;

  const ymlLines = [
    [[TK.prop, 'validate-schema-names'], [TK.op, ':']],
    ['    ', [TK.prop, 'parallel'], [TK.op, ': '], [TK.num, 'true']],
    [[TK.prop, 'validate-schema-registration'], [TK.op, ':']],
    ['    ', [TK.prop, 'parallel'], [TK.op, ': '], [TK.num, 'true']],
    [[TK.prop, 'validate-index-accessors'], [TK.op, ':']],
    ['    ', [TK.prop, 'parallel'], [TK.op, ': '], [TK.num, 'true']],
    '',
    [[TK.prop, 'verify-server-running'], [TK.op, ': {}']],
    [[TK.prop, 'no-outdated-schema'],    [TK.op, ':    {}']],
    '',
    [[TK.prop, 'PreToolUse'], [TK.op, ':']],
    ['  ', [TK.prop, 'order'], [TK.op, ':']],
    ['    - ', [TK.str, 'validate-schema-names']],
    ['    - ', [TK.str, 'validate-schema-registration']],
    ['    - ', [TK.str, 'validate-index-accessors']],
    ['    - ', [TK.str, 'verify-server-running']],
    ['    - ', [TK.str, 'no-outdated-schema']],
  ];

  const twoColStyle = {
    display: 'grid',
    gridTemplateColumns: stack ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: stack ? 28 : 48,
    alignItems: 'start',
  };

  return (
    <section id="ordering" className="section section--elev">
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Ordering</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 56px', maxWidth: 780,
        }}>
          Slow hooks shouldn't fire for{'\u00a0'}nothing.
        </h2>

        {/* Sub-block 1: problem */}
        <div style={{ ...twoColStyle, marginBottom: 32 }}>
          <p style={{ fontSize: 15, color: COL.fgMute, margin: 0, lineHeight: 1.6, alignSelf: 'center' }}>
            Claude Code runs every matching hook in parallel. Nothing stops a
            slow hook when a fast one already said no — and any short-circuit
            logic has to be duplicated into every hook that needs{'\u00a0'}it.
          </p>

          <div style={{
            border: `1px solid ${COL.line}`, background: COL.bgSoft,
            padding: '22px 26px',
            display: 'grid', gridTemplateColumns: '20px 1fr', gap: 18,
          }}>
            <div style={{ width: 2, background: COL.red, alignSelf: 'stretch' }}/>
            <div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COL.fgDim, marginBottom: 8 }}>
                claude-code · <a
                  href="https://github.com/anthropics/claude-code/issues/15897"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: COL.fgDim, textDecoration: 'underline' }}
                >issue #15897</a>
              </div>
              <div style={{ fontSize: 14.5, color: COL.fg, lineHeight: 1.55 }}>
                "All hooks run in parallel. There is no ordering guarantee, no way to
                chain modifications, no way to know which one{'\u00a0'}blocked."
              </div>
            </div>
          </div>
        </div>

        {/* Sub-block 2: answer (flowchart in right column, below prose) */}
        <div style={{ ...twoColStyle }}>
          <div style={{ order: stack ? 2 : 0 }}>
            <div style={{
              fontSize: 11, color: COL.fgDim, marginBottom: 10,
              fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1, textTransform: 'uppercase',
            }}>.clooks/clooks.yml</div>
            <CodeCard lines={ymlLines} lineNumbers={false}/>
          </div>

          <div style={{ paddingTop: stack ? 0 : 32, order: stack ? 1 : 0 }}>
            <p style={{ fontSize: 14.5, color: COL.fgMute, margin: '0 0 36px', lineHeight: 1.6 }}>
              Clooks parallelizes and orders hooks. Expensive checks only run when
              the cheap ones passed — no duplicated short-circuit logic in every{'\u00a0'}hook.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <OrderingFlowchart accent={accent}/>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function OrderingFlowchart({ accent }) {
  return (
    <svg
      viewBox="0 0 460 300"
      style={{ width: '100%', maxWidth: 460, height: 'auto' }}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <marker id="of-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill={COL.fgMute}/>
        </marker>
        <marker id="of-arrow-accent" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill={accent}/>
        </marker>
        <marker id="of-arrow-green" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill={COL.green}/>
        </marker>
      </defs>

      {/* Parallel group — three boxes */}
      {[0, 162, 324].map((x, i) => (
        <g key={i}>
          <rect x={x} y="0" width="130" height="50" fill="none" stroke={accent} strokeWidth="1"/>
          <text x={x + 65} y="22" textAnchor="middle"
                fontFamily="JetBrains Mono, monospace" fontSize="12" fill={COL.fg}>
            validate
          </text>
          <text x={x + 65} y="38" textAnchor="middle"
                fontFamily="JetBrains Mono, monospace" fontSize="12" fill={COL.fg}>
            local code
          </text>
        </g>
      ))}

      {/* Verticals from each parallel box to rail */}
      <line x1="65"  y1="50" x2="65"  y2="80" stroke={accent} strokeWidth="1"/>
      <line x1="227" y1="50" x2="227" y2="80" stroke={accent} strokeWidth="1"/>
      <line x1="389" y1="50" x2="389" y2="80" stroke={accent} strokeWidth="1"/>

      {/* Rail -> middle box */}
      <line x1="227" y1="80" x2="227" y2="108" stroke={accent} strokeWidth="1" markerEnd="url(#of-arrow-accent)"/>

      {/* Horizontal rail joining parallel outputs */}
      <line x1="65" y1="80" x2="389" y2="80" stroke={accent} strokeWidth="1"/>

      {/* Middle box */}
      <rect x="137" y="110" width="180" height="50" fill="none" stroke={COL.line} strokeWidth="1"/>
      <text x="227" y="140" textAnchor="middle"
            fontFamily="JetBrains Mono, monospace" fontSize="12" fill={COL.fg}>
        test server up?
      </text>

      {/* Middle -> bottom */}
      <line x1="227" y1="160" x2="227" y2="188" stroke={COL.fgMute} strokeWidth="1" markerEnd="url(#of-arrow)"/>

      {/* Bottom box */}
      <rect x="137" y="190" width="180" height="50" fill="none" stroke={COL.line} strokeWidth="1"/>
      <text x="227" y="220" textAnchor="middle"
            fontFamily="JetBrains Mono, monospace" fontSize="12" fill={COL.fg}>
        schema current?
      </text>

      {/* Bottom -> green payoff */}
      <line x1="227" y1="240" x2="227" y2="268" stroke={COL.green} strokeWidth="1" markerEnd="url(#of-arrow-green)"/>

      {/* Green payoff text, no box */}
      <text x="227" y="288" textAnchor="middle"
            fontFamily="JetBrains Mono, monospace" fontSize="13" fontWeight="500" fill={COL.green}>
        good to go — run E2E tests
      </text>
    </svg>
  );
}

Object.assign(window, { OrderingSection, OrderingFlowchart });
