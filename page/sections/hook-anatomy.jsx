function HookAnatomySection({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;
  const items = [
    { n: '01', k: 'meta', hl: 'meta',
      d: 'Static configurations for your hook.' },
    { n: '02', k: 'config', hl: 'config',
      d: 'Set up configurations that you can later change in the clooks.yml file.' },
    { n: '03', k: 'Lifecycles', hl: 'lifecycle',
      d: 'Runs before/after every event on this hook. Allows set up or short circuiting without duplicaton.' },
    { n: '04', k: 'Event methods', hl: 'events',
      d: 'Subscribe to hooks by event name. Implement PreToolUse, you handle PreToolUse.' },
    { n: '05', k: 'Typed ctx, tagged result', hl: 'result',
      d: 'Typed input in, discriminated union out. The tag is the decision: allow, block, skip, ask, defer.' },
  ];
  // Line indices into anatomyLines below, keyed by item.hl
  const HL = {
    meta:      [4, 5, 6, 7, 8, 9, 10],
    config:    [7, 8, 9],
    lifecycle: [12, 13, 14, 15, 16],
    events:    [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39],
    result:    [19, 21, 22, 25, 26, 27, 28, 29, 32, 33, 34, 35, 36, 37, 38],
  };
  const [hovered, setHovered] = React.useState(null);
  const hlSet = new Set(hovered ? HL[hovered] : []);

  // ----- Reuse panel data: same hook, configured three ways -----
  const reuseConfigs = [
    {
      repo: 'platform-api',
      path: '.clooks/clooks.yml',
      summary: <>Shared repo. Ship the defaults — every rule on.</>,
      lines: [
        [[TK.com, '# All 13 rules default to true.']],
        [[TK.prop, 'no-destructive-git'], [TK.op, ': {}']],
      ],
    },
    {
      repo: 'scratch-pad',
      path: '.clooks/clooks.yml',
      summary: <>Solo repo. Trust local ops; keep the blast-radius blocks.</>,
      lines: [
        [[TK.prop, 'no-destructive-git'], [TK.op, ':']],
        ['  ', [TK.prop, 'config'], [TK.op, ':']],
        ['    ', [TK.prop, 'reset-hard'], [TK.op, ': '], [TK.kw, 'false']],
        ['    ', [TK.prop, 'clean-force'], [TK.op, ': '], [TK.kw, 'false']],
        ['    ', [TK.prop, 'stash-drop'], [TK.op, ': '], [TK.kw, 'false']],
      ],
    },
    {
      repo: 'acme-corp/monorepo',
      path: '.clooks/clooks.yml',
      summary: <>Team default plus one house rule: open a PR, don't push to{'\u00a0'}main.</>,
      lines: [
        [[TK.prop, 'no-destructive-git'], [TK.op, ':']],
        ['  ', [TK.prop, 'config'], [TK.op, ':']],
        ['    ', [TK.prop, 'additionalRules'], [TK.op, ':']],
        ['      - ', [TK.prop, 'match'], [TK.op, ': '], [TK.str, "'push.*\\s(main|master)\\b'"]],
        ['        ', [TK.prop, 'message'], [TK.op, ': '], [TK.str, "'Open a PR first.'"]],
      ],
    },
  ];
  const reuseMaxLines = Math.max(...reuseConfigs.map((c) => c.lines.length));
  const padReuse = (lines) => [
    ...lines,
    ...Array(Math.max(0, reuseMaxLines - lines.length)).fill(''),
  ];
  const ReuseCard = ({ cfg }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase',
          color: accent, border: `1px solid ${accent}`, padding: '3px 8px',
        }}>
          {cfg.repo}
        </span>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
          color: COL.fgMute, wordBreak: 'break-all',
        }}>
          {cfg.path}
        </span>
      </div>
      <CodeCard lines={padReuse(cfg.lines)} lineNumbers={false} compact/>
      <div style={{ fontSize: 13, color: COL.fgMute, lineHeight: 1.55 }}>
        {cfg.summary}
      </div>
    </div>
  );
  const anatomyLines = [
    [[TK.com, '// .clooks/hooks/no-bare-mv.ts']],
    [[TK.kw, 'import type'], [TK.op, ' { '], [TK.ty, 'ClooksHook'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'clooks'"]],
    '',
    [[TK.kw, 'export const'], [TK.fn, ' hook'], [TK.op, ': '], [TK.ty, 'ClooksHook'], [TK.op, ' = {']],
    ['  ', [TK.prop, 'meta'], [TK.op, ': {']],
    ['    ', [TK.prop, 'name'], [TK.op, ': '], [TK.str, "'no-bare-mv'"], [TK.op, ',']],
    ['    ', [TK.prop, 'description'], [TK.op, ': '], [TK.str, "'Rewrite bare mv to git mv.'"], [TK.op, ',']],
    ['    ', [TK.prop, 'config'], [TK.op, ': {']],
    ['      ', [TK.prop, 'autoFix'], [TK.op, ': '], [TK.kw, 'true'], [TK.op, ',']],
    ['    ', [TK.op, '},']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'beforeHook'], [TK.op, '('], [TK.ty, 'event'], [TK.op, ') {'], '  ', [TK.com, '// runs before every event method']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (!event.'], [TK.prop, 'meta'], [TK.op, '.'], [TK.prop, 'gitRoot'], [TK.op, ') {']],
    ['      ', [TK.kw, 'return'], [TK.op, ' event.'], [TK.fn, 'respond'], [TK.op, '({ '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' })']],
    ['    ', [TK.op, '}']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'PreToolUse'], [TK.op, '('], [TK.ty, 'ctx'], [TK.op, ', '], [TK.ty, 'config'], [TK.op, ') {']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (ctx.'], [TK.prop, 'toolName'], [TK.op, ' !== '], [TK.str, "'Bash'"], [TK.op, ') '], [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (!'], [TK.fn, 'BARE_MV_REGEX'], [TK.op, '.'], [TK.fn, 'test'], [TK.op, '(ctx.'], [TK.prop, 'toolInput'], [TK.op, '.command)) {']],
    ['      ', [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    ['    ', [TK.op, '}']],
    '',
    ['    ', [TK.kw, 'if'], [TK.op, ' (!config.'], [TK.prop, 'autoFix'], [TK.op, ') {']],
    ['      ', [TK.kw, 'return'], [TK.op, ' {']],
    ['        ', [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'allow'"], [TK.op, ',']],
    ['        ', [TK.prop, 'injectContext'], [TK.op, ': '], [TK.str, "'Use git mv to preserve history.'"], [TK.op, ',']],
    ['      ', [TK.op, '}']],
    ['    ', [TK.op, '}']],
    '',
    ['    ', [TK.kw, 'const'], [TK.fn, ' rewritten'], [TK.op, ' = '], [TK.fn, 'rewrite'], [TK.op, '(ctx.'], [TK.prop, 'toolInput'], [TK.op, '.command)']],
    ['    ', [TK.kw, 'return'], [TK.op, ' {']],
    ['      ', [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'allow'"], [TK.op, ',']],
    ['      ', [TK.prop, 'updatedInput'], [TK.op, ': { '], [TK.prop, 'command'], [TK.op, ': rewritten },']],
    ['    ', [TK.op, '}']],
    ['  ', [TK.op, '},']],
    [[TK.op, '}']],
  ];

  return (
    <section id="hook" className="section">
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Hook API</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 780,
        }}>
          A hook is an object.<br/>
          <span style={{ color: COL.fgMute }}>One file. One hook. Many{'\u00a0'}events.</span>
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 56px', lineHeight: 1.6 }}>
          Each file exports one <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>ClooksHook</code> object, which can handle one or more events.
          Every event you handle is a method with a typed context and a typed return.
          Hover a row below to see where it lives in the{'\u00a0'}source.
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: stack ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: stack ? 32 : 48, alignItems: 'start',
        }}>
          <div style={{ position: stack ? 'static' : 'sticky', top: 100, minWidth: 0 }}>
            <div style={{
              background: COL.bgCode, border: `1px solid ${COL.line}`,
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: vp.isMobile ? 10 : 12.5,
              lineHeight: 1.65, overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderBottom: `1px solid ${COL.line}`,
                fontSize: 11, color: COL.fgDim,
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, background: '#4a4a4a', display: 'inline-block' }}/>
                  no-bare-mv.ts
                </span>
                <span style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: COL.fgDim }}>
                  typescript
                </span>
              </div>
              {(() => {
                const srcFont = vp.isMobile ? 10 : 12.5;
                const lineH = srcFont * 1.65;
                return (
                  <div style={{ display: 'flex', padding: '14px 0' }}>
                    <div style={{
                      padding: vp.isMobile ? '0 8px' : '0 12px', color: COL.fgFaint, textAlign: 'right',
                      borderRight: `1px solid ${COL.line}`, userSelect: 'none',
                      minWidth: vp.isMobile ? 28 : 36,
                    }}>
                      {anatomyLines.map((_, i) => (
                        <div key={i} style={{
                          minHeight: lineH,
                          color: hlSet.has(i) ? accent : COL.fgFaint,
                          transition: 'color 180ms ease',
                        }}>{i + 1}</div>
                      ))}
                    </div>
                    <div style={{ padding: 0, flex: 1, minWidth: 0, overflowX: vp.isMobile ? 'visible' : 'auto' }}>
                      {anatomyLines.map((l, i) => {
                        const on = hlSet.has(i);
                        return (
                          <div key={i} style={{
                            whiteSpace: vp.isMobile ? 'pre-wrap' : 'pre',
                            overflowWrap: vp.isMobile ? 'anywhere' : 'normal',
                            minHeight: lineH,
                            padding: '0 14px',
                            background: on ? 'rgba(251,191,36,0.09)' : 'transparent',
                            borderLeft: `2px solid ${on ? accent : 'transparent'}`,
                            marginLeft: on ? 0 : 2,
                            paddingLeft: on ? 12 : 14,
                            transition: 'background 180ms ease, border-color 180ms ease',
                          }}>
                            {renderLine(l)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
          <div style={{ alignSelf: 'center' }}>
            {items.map(item => {
              const active = hovered === item.hl;
              return (
                <div
                  key={item.n}
                  onMouseEnter={() => setHovered(item.hl)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(item.hl)}
                  onBlur={() => setHovered(null)}
                  tabIndex={0}
                  style={{
                    padding: '20px 12px', borderBottom: `1px solid ${COL.line}`,
                    display: 'grid', gridTemplateColumns: '44px 1fr', gap: 20,
                    cursor: 'pointer', outline: 'none',
                    background: active ? 'rgba(255,255,255,0.02)' : 'transparent',
                    borderLeft: `2px solid ${active ? accent : 'transparent'}`,
                    marginLeft: active ? -14 : -12,
                    paddingLeft: active ? 12 : 14,
                    transition: 'background 180ms ease, border-color 180ms ease',
                  }}
                >
                  <div style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                    color: accent, paddingTop: 2,
                  }}>{item.n}</div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: COL.fg, marginBottom: 6 }}>
                      {item.k}
                    </div>
                    <div style={{ fontSize: 14, color: COL.fgMute, lineHeight: 1.6 }}>
                      {item.d}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{
          marginTop: stack ? 56 : 80,
          paddingTop: stack ? 48 : 64,
          borderTop: `1px solid ${COL.line}`,
        }}>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: 2,
            textTransform: 'uppercase', color: COL.fgDim, marginBottom: 18,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ width: 24, height: 1, background: COL.fgDim, display: 'inline-block' }}/>
            Write once. Configure everywhere.
          </div>
          <h3 style={{
            fontSize: 'clamp(22px, 2.4vw, 30px)', lineHeight: 1.2,
            letterSpacing: -0.6, fontWeight: 500, margin: '0 0 14px', maxWidth: 760,
          }}>
            Same hook. Three repos. Three{'\u00a0'}dials.
          </h3>
          <p style={{ fontSize: 14.5, color: COL.fgMute, maxWidth: 680, margin: '0 0 36px', lineHeight: 1.6 }}>
            A hook's <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>meta.config</code> is
            its public interface. Here's <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>no-destructive-git</code>
            {' '} configured to suit each repositories use case without having to write three separate hooks.
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: stack ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))',
            gap: stack ? 24 : 20,
          }}>
            {reuseConfigs.map((cfg) => <ReuseCard key={cfg.repo} cfg={cfg}/>)}
          </div>
        </div>

      </div>
    </section>
  );
}

Object.assign(window, { HookAnatomySection });
