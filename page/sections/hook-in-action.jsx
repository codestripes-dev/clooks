function HookInActionSection({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;
  // Timeline (ms) of a single loop. Each tick advances the scene.
  const SCENE = [
    { at: 0,    step: 'idle',     highlight: null },
    { at: 300,  step: 'typing',   highlight: null },
    { at: 2100, step: 'sent',     highlight: null },
    { at: 2500, step: 'pre-tool', highlight: 'guard' },   // ctx.tool !== 'Bash' check
    { at: 3000, step: 'parse',    highlight: 'regex' },   // dangerous = /rm.../.test
    { at: 3500, step: 'decide',   highlight: 'return' },  // returns block
    { at: 3900, step: 'blocked',  highlight: 'return' },
    { at: 4800, step: 'reply',    highlight: null },
    { at: 6200, step: 'idle',     highlight: null },      // loop end
  ];
  const END_MS = 6200;

  const fullPrompt = 'clean up stale artifacts: rm -rf /tmp/build ~';
  const [t, setT] = React.useState(0);
  const [inView, setInView] = React.useState(true);
  const sectionRef = React.useRef(null);
  const rafRef = React.useRef(0);
  const accumRef = React.useRef(0);
  const lastTsRef = React.useRef(0);

  const jumpTo = React.useCallback((ms) => {
    accumRef.current = ms;
    lastTsRef.current = 0;
    setT(ms);
  }, []);

  React.useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => { for (const e of entries) setInView(e.isIntersecting); },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const loop = (now) => {
      if (cancelled) return;
      if (!inView) {
        lastTsRef.current = 0;
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      if (!lastTsRef.current) lastTsRef.current = now;
      const dt = now - lastTsRef.current;
      lastTsRef.current = now;

      if (accumRef.current < END_MS) {
        accumRef.current = Math.min(END_MS, accumRef.current + dt);
        setT(accumRef.current);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelled = true; cancelAnimationFrame(rafRef.current); };
  }, [inView]);

  // Find current scene entry
  const scene = SCENE.reduce((acc, s) => (t >= s.at ? s : acc), SCENE[0]);

  // Typing progress for the prompt
  const typingStart = 300, typingEnd = 2100;
  const typed = (() => {
    if (t < typingStart) return '';
    if (t >= typingEnd) return fullPrompt;
    const p = (t - typingStart) / (typingEnd - typingStart);
    return fullPrompt.slice(0, Math.floor(p * fullPrompt.length));
  })();

  // Which terminal lines should be visible
  const showSent     = t >= 2100;
  const showPre      = t >= 2600;
  const showBlocked  = t >= 3900;
  const showReply    = t >= 4800;

  // Source-code line highlights keyed by scene.highlight
  // Our hook source is 19 lines. Line indices below are 0-based.
  const HL = {
    guard:  [10],       // if (ctx.tool !== 'Bash') return skip
    regex:  [12, 13],   // const cmd / const dangerous = regex
    return: [15, 16, 17], // return dangerous ? block : allow
  };
  const hlSet = new Set(scene.highlight ? HL[scene.highlight] : []);

  const hookLines = [
    [[TK.com, '// .clooks/hooks/no-rm-rf.ts']],
    [[TK.kw, 'import type'], [TK.op, ' { '], [TK.ty, 'ClooksHook'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'clooks'"]],
    '',
    [[TK.kw, 'export const'], [TK.fn, ' hook'], [TK.op, ': '], [TK.ty, 'ClooksHook'], [TK.op, ' = {']],
    ['  ', [TK.prop, 'meta'], [TK.op, ': {']],
    ['    ', [TK.prop, 'name'], [TK.op, ': '], [TK.str, "'no-rm-rf'"], [TK.op, ',']],
    ['    ', [TK.prop, 'description'], [TK.op, ': '], [TK.str, "'Block destructive rm commands.'"], [TK.op, ',']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'PreToolUse'], [TK.op, '('], [TK.ty, 'ctx'], [TK.op, ') {']],
    ['    ', [TK.kw, 'if'], [TK.op, ' ('], [TK.ty, 'ctx'], [TK.op, '.tool '], [TK.op, '!== '], [TK.str, "'Bash'"], [TK.op, ') '], [TK.kw, 'return'], [TK.op, ' '], [TK.ty, 'ctx'], [TK.op, '.'], [TK.fn, 'skip'], [TK.op, '()']],
    '',
    ['    ', [TK.kw, 'const'], [TK.fn, ' cmd '], [TK.op, '= '], [TK.ty, 'ctx'], [TK.op, '.input.command '], [TK.op, '?? '], [TK.str, "''"]],
    ['    ', [TK.kw, 'const'], [TK.fn, ' dangerous '], [TK.op, '= /'], [TK.str, 'rm\\s+-rf?\\s+(\\/|~|\\$HOME)'], [TK.op, '/.test(cmd)']],
    '',
    ['    ', [TK.kw, 'return'], [TK.fn, ' dangerous'],],
    ['      ', [TK.op, '? '], [TK.ty, 'ctx'], [TK.op, '.'], [TK.fn, 'block'], [TK.op, '({ '], [TK.prop, 'reason'], [TK.op, ': '], [TK.str, "`refusing: ${cmd}`"], [TK.op, ' })']],
    ['      ', [TK.op, ': '], [TK.ty, 'ctx'], [TK.op, '.'], [TK.fn, 'allow'], [TK.op, '()']],
    ['  ', [TK.op, '},']],
    [[TK.op, '}']],
  ];

  // Step ribbon under the title. Each stage owns a 25% slice of the progress bar.
  // `at` is the t (ms) the animation jumps to on click.
  const ribbon = [
    { id: 'typing',   at: 0,    label: '01 · User prompt' },
    { id: 'pre-tool', at: 2100, label: '02 · PreToolUse fires' },
    { id: 'decide',   at: 3500, label: '03 · Hook returns block' },
    { id: 'reply',    at: 4800, label: '04 · Claude relays reason' },
  ];
  // Stage ranges in t-space (ms). Each stage maps to 25% of the progress bar.
  const stageRanges = [
    [0, 2100],
    [2100, 3500],
    [3500, 4800],
    [4800, END_MS],
  ];
  const ribbonActive = (() => {
    if (t < stageRanges[1][0]) return 'typing';
    if (t < stageRanges[2][0]) return 'pre-tool';
    if (t < stageRanges[3][0]) return 'decide';
    return 'reply';
  })();
  const progressPct = (() => {
    const idx = stageRanges.findIndex(([, b]) => t < b);
    if (idx === -1) return 100;
    const [a, b] = stageRanges[idx];
    return idx * 25 + ((Math.max(t, a) - a) / (b - a)) * 25;
  })();

  return (
    <section ref={sectionRef} className="section section--elev">
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Hook in action</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 820,
        }}>
          A hook decides.<br/>
          <span style={{ color: COL.fgMute }}>Step by step.</span>
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 680, margin: '0 0 28px', lineHeight: 1.6 }}>
          On the left, a Claude Code session. On the right, the hook file.
        </p>

        {/* Step ribbon — clickable */}
        <div style={{
          display: vp.isMobile ? 'grid' : 'flex',
          gridTemplateColumns: vp.isMobile ? '1fr 1fr' : undefined,
          gap: 0, borderTop: `1px solid ${COL.line}`,
        }}>
          {ribbon.map((r, i) => {
            const active = r.id === ribbonActive;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => jumpTo(r.at)}
                style={{
                  all: 'unset', boxSizing: 'border-box', cursor: 'pointer',
                  flex: 1, padding: vp.isMobile ? '10px 12px' : '12px 16px',
                  borderLeft: (vp.isMobile ? (i % 2 === 0) : i === 0) ? 'none' : `1px solid ${COL.line}`,
                  borderTop: vp.isMobile && i >= 2 ? `1px solid ${COL.line}` : 'none',
                  background: active ? 'rgba(255,255,255,0.02)' : 'transparent',
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                  letterSpacing: 0.6, color: active ? accent : COL.fgDim,
                  transition: 'color 180ms ease, background 180ms ease',
                }}
                aria-pressed={active}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {/* Progress bar — spans all stages */}
        <div style={{
          height: 3, background: 'rgba(255,255,255,0.06)',
          borderBottom: `1px solid ${COL.line}`, marginBottom: 24, position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, bottom: 0,
            width: `${progressPct}%`,
            background: accent,
          }}/>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: stack ? '1fr' : 'minmax(0, 1.2fr) minmax(0, 1fr)',
            gap: 24, alignItems: 'start',
          }}
        >
          {/* Left: terminal */}
          <div style={{
            background: COL.bgCode, border: `1px solid ${COL.line}`,
            fontFamily: 'JetBrains Mono, monospace', fontSize: 13, lineHeight: 1.6,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderBottom: `1px solid ${COL.line}`,
              fontSize: 11, color: COL.fgDim,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <span style={{ width: 8, height: 8, background: '#3f3f46', display: 'inline-block' }}/>
                  <span style={{ width: 8, height: 8, background: '#3f3f46', display: 'inline-block' }}/>
                  <span style={{ width: 8, height: 8, background: '#3f3f46', display: 'inline-block' }}/>
                </span>
                <span style={{ color: COL.fgMute }}>claude</span>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ color: scene.highlight ? accent : COL.fgDim, transition: 'color 200ms' }}>
                  {scene.highlight ? 'PreToolUse · running' : 'idle'}
                </span>
              </div>
            </div>
            <div style={{ padding: '18px 18px 22px', color: COL.fg, minHeight: 260 }}>
              {/* Prompt with typing caret */}
              <div style={{ whiteSpace: 'pre-wrap' }}>
                <span style={{ color: accent, marginRight: 10 }}>❯</span>
                <span>{typed}</span>
                {(t >= typingStart && t < typingEnd) && (
                  <span style={{
                    display: 'inline-block', width: 7, height: 15,
                    background: COL.fg, marginLeft: 2, verticalAlign: '-2px',
                    animation: 'blink 1s steps(1) infinite',
                  }}/>
                )}
              </div>

              {showSent && <div style={{ height: 12 }}/>}

              {showPre && (
                <>
                  <div style={{ color: COL.fgDim }}>  Ran 1 bash command</div>
                  <div style={{ color: COL.fgDim }}>
                    {'  ⎿  '}
                    {showBlocked
                      ? <span style={{ color: COL.red }}>PreToolUse:Bash hook returned blocking error</span>
                      : <span style={{ color: accent }}>PreToolUse:Bash running no-rm-rf…</span>
                    }
                  </div>
                </>
              )}

              {showBlocked && (
                <div style={{ color: COL.fgDim }}>
                  {'  ⎿  '}
                  <span style={{ color: COL.fg }}>refusing: </span>
                  <span style={{ color: COL.fg }}>rm -rf /tmp/build ~</span>
                </div>
              )}

              {showReply && <div style={{ height: 12 }}/>}

              {showReply && (
                <>
                  <div>
                    <span style={{ color: accent, marginRight: 8 }}>●</span>
                    <span>The </span>
                    <span style={{ color: COL.fg }}>no-rm-rf</span>
                    <span> hook blocked this. The trailing </span>
                    <span style={{ color: COL.fg }}>~</span>
                    <span> would have wiped your home directory.</span>
                  </div>
                  <div style={{ color: COL.fgMute, marginTop: 6 }}>
                    Want me to run it without the <span style={{ color: COL.fg }}>~</span>?
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right: hook source with line highlighting */}
          <div style={{
            background: COL.bgCode, border: `1px solid ${COL.line}`,
            fontFamily: 'JetBrains Mono, monospace', fontSize: vp.isMobile ? 8.5 : 12.5,
            lineHeight: 1.65, overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderBottom: `1px solid ${COL.line}`,
              fontSize: 11, color: COL.fgDim,
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, background: '#4a4a4a', display: 'inline-block' }}/>
                no-rm-rf.ts
              </span>
              <span style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: COL.fgDim }}>
                typescript
              </span>
            </div>
            {(() => {
              const srcFont = vp.isMobile ? 8.5 : 12.5;
              const lineH = srcFont * 1.65;
              return (
                <div style={{ display: 'flex', padding: '14px 0' }}>
                  <div style={{
                    padding: vp.isMobile ? '0 8px' : '0 12px', color: COL.fgFaint, textAlign: 'right',
                    borderRight: `1px solid ${COL.line}`, userSelect: 'none', minWidth: vp.isMobile ? 28 : 36,
                  }}>
                    {hookLines.map((_, i) => (
                      <div key={i} style={{
                        minHeight: lineH,
                        color: hlSet.has(i) ? accent : COL.fgFaint,
                        transition: 'color 180ms ease',
                      }}>{i + 1}</div>
                    ))}
                  </div>
                  <div style={{ padding: vp.isMobile ? '0 10px' : '0 0', flex: 1, minWidth: 0, overflowX: vp.isMobile ? 'visible' : 'auto' }}>
                    {hookLines.map((l, i) => {
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
            <div style={{
              padding: '10px 14px', borderTop: `1px solid ${COL.line}`,
              fontSize: 11, color: COL.fgDim, display: 'flex', justifyContent: 'space-between',
            }}>
              <span>
                {scene.highlight === 'guard' && 'tool gate — not Bash? skip'}
                {scene.highlight === 'regex' && 'regex match on ctx.input.command'}
                {scene.highlight === 'return' && 'decision: ctx.block({ reason })'}
                {!scene.highlight && 'waiting for PreToolUse'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { HookInActionSection });
