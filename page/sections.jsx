// Body sections: problem, hook anatomy, config, install flow, comparison,
// why-not-plugin, roadmap, faq, footer

// ---------- Copyable command box (used in Install tabs) ----------
function CmdBox({ accent, cmd, slash, comment }) {
  const vp = useViewport();
  const wrap = vp.isMobile;
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(cmd);
        ok = true;
      }
    } catch {}
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = cmd;
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {}
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };
  return (
    <div style={{
      background: COL.bgCode, border: `1px solid ${COL.line}`,
      fontFamily: 'JetBrains Mono, monospace', fontSize: wrap ? 9.5 : 12.5,
      color: COL.fg, alignSelf: 'start', position: 'relative',
      display: 'flex', alignItems: 'flex-start',
    }}>
      <div style={{
        flex: 1, padding: '14px 16px', minWidth: 0,
        whiteSpace: wrap ? 'pre-wrap' : 'pre',
        overflowX: wrap ? 'visible' : 'auto',
        wordBreak: wrap ? 'break-all' : 'normal',
        textIndent: wrap ? '-1.4em' : 0,
        paddingLeft: wrap ? '2.6em' : '16px',
      }}>
        {comment
          ? <span style={{ color: COL.fgDim }}>{cmd}</span>
          : <><span style={{ color: accent, marginRight: 10 }}>{slash ? '>' : '$'}</span>{cmd}</>}
      </div>
      {!comment && (
        <button onClick={copy} title={copied ? 'Copied' : 'Copy'} style={{
          flex: '0 0 auto',
          background: copied ? accent : 'transparent',
          border: 'none',
          borderLeft: `1px solid ${COL.line}`,
          color: copied ? COL.bg : COL.fgMute, cursor: 'pointer',
          padding: '14px 16px', fontFamily: 'inherit', fontSize: 11,
          fontWeight: copied ? 600 : 400,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          alignSelf: 'stretch', letterSpacing: 0.3,
          transition: 'background 120ms ease, color 120ms ease',
        }}>
          {copied ? (
            <><svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6.5 L5 9.5 L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"/>
            </svg>Copied!</>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="3.5" y="3.5" width="6" height="6" stroke="currentColor" strokeWidth="1" fill="none"/>
              <path d="M2 2 H8 V3" stroke="currentColor" strokeWidth="1" fill="none"/>
            </svg>
          )}
        </button>
      )}
    </div>
  );
}

// ---------- Hook in action: animated terminal + synced hook source ----------
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
    ['    ', [TK.kw, 'if'], [TK.op, ' ('], [TK.ty, 'ctx'], [TK.op, '.tool '], [TK.op, '!== '], [TK.str, "'Bash'"], [TK.op, ') '], [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    '',
    ['    ', [TK.kw, 'const'], [TK.fn, ' cmd '], [TK.op, '= '], [TK.ty, 'ctx'], [TK.op, '.input.command '], [TK.op, '?? '], [TK.str, "''"]],
    ['    ', [TK.kw, 'const'], [TK.fn, ' dangerous '], [TK.op, '= /'], [TK.str, 'rm\\s+-rf?\\s+(\\/|~|\\$HOME)'], [TK.op, '/.test(cmd)']],
    '',
    ['    ', [TK.kw, 'return'], [TK.fn, ' dangerous'],],
    ['      ', [TK.op, '? { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'block'"], [TK.op, ', '], [TK.prop, 'reason'], [TK.op, ': '], [TK.str, "`refusing: ${cmd}`"], [TK.op, ' }']],
    ['      ', [TK.op, ': { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'allow'"], [TK.op, ' }']],
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
    <section
      ref={sectionRef}
      style={{
        padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
        borderBottom: `1px solid ${COL.line}`, background: COL.bgElev,
      }}
    >
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
            <div style={{ display: 'flex', padding: '14px 0' }}>
              <div style={{
                padding: vp.isMobile ? '0 8px' : '0 12px', color: COL.fgFaint, textAlign: 'right',
                borderRight: `1px solid ${COL.line}`, userSelect: 'none', minWidth: vp.isMobile ? 28 : 36,
              }}>
                {hookLines.map((_, i) => (
                  <div key={i} style={{
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
                      minHeight: vp.isMobile ? 17.3 : 20.6,
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
            <div style={{
              padding: '10px 14px', borderTop: `1px solid ${COL.line}`,
              fontSize: 11, color: COL.fgDim, display: 'flex', justifyContent: 'space-between',
            }}>
              <span>
                {scene.highlight === 'guard' && 'tool gate — not Bash? skip'}
                {scene.highlight === 'regex' && 'regex match on ctx.input.command'}
                {scene.highlight === 'return' && 'tagged result: block + reason'}
                {!scene.highlight && 'waiting for PreToolUse'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Problem: rm -rf story + pain list ----------
function ProblemSection({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;
  const cols = vp.isMobile ? 1 : vp.isTablet ? 2 : 3;
  const brokenHookLines = [
    [[TK.com, '#!/bin/bash']],
    [[TK.com, '# .claude/hooks/no-rm-rf.sh']],
    '',
    [[TK.fn, 'cmd'], [TK.op, '=$('], 'jq -r ', [TK.str, "'.tool_input.command'"], [TK.op, ')']],
    '',
    [[TK.kw, 'if'], ' ', [TK.fn, 'echo'], ' ', [TK.str, '"$cmd"'], ' | ', [COL.red, 'rg'], ' ', [TK.str, "'^rm\\s+-rf'"], '; ', [TK.kw, 'then']],
    ['  ', [TK.fn, 'echo'], ' ', [TK.str, '"refusing rm -rf"'], ' >&2'],
    ['  ', [TK.kw, 'exit'], ' ', [TK.num, '2']],
    [[TK.kw, 'fi']],
  ];
  const pains = [
    { n: '01', k: 'Silent failures',
      d: 'Claude Code only blocks on exit code 2. A guard hook that crashes — a typo, a missing dep — doesn\'t prevent the action. The action runs as if the hook never ran.' },
    { n: '02', k: 'Bash inside JSON',
      d: 'Native hooks are bash strings inside .claude/settings.json. No schema, no types, no imports — every hook is a one-liner you quote by hand.' },
    { n: '03', k: 'No composition',
      d: 'All native hooks run in parallel. No ordering, no pipeline, no way for one hook to modify input before another sees it. (Open issue claude-code#15897.)' },
    { n: '04', k: 'No portability',
      d: 'A hook that works on your machine lives in your settings. A teammate clones the repo and gets nothing — or a different version.' },
    { n: '05', k: 'No discoverability',
      d: 'The best hooks are gists linked in Discord threads. There is no registry, no pinning, no lockfile.' },
  ];

  return (
    <section id="problem" style={{
      padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
      borderBottom: `1px solid ${COL.line}`,
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Problem</SectionLabel>

        {/* 2-col: narrative + quote on left, broken hook + transcript on right */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: stack ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1.1fr)',
          gap: stack ? 40 : 56, margin: '0 0 64px',
          alignItems: 'start',
        }}>
          <div>
            <h2 style={{
              fontSize: 'clamp(28px, 3.2vw, 42px)', lineHeight: 1.1,
              letterSpacing: -1, fontWeight: 500, margin: '0 0 20px',
            }}>
              The hook that was supposed<br/>to stop <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85em', color: COL.red, background: 'rgba(248,113,113,0.08)', padding: '2px 8px' }}>rm -rf ~/</code> crashed.
            </h2>
            <p style={{ fontSize: 16, color: COL.fgMute, margin: '0 0 32px', lineHeight: 1.6 }}>
              Somebody's agent ran <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>rm -rf tests/ patches/ plan/ ~/</code> —
              the trailing <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>~/</code> wiped the Mac.
              A guard hook was meant to catch it, but threw an exception and exited with a non-2 code.
              Claude Code treats anything other than exit 2 as success, so the command ran. In Clooks,
              a crashed hook blocks the action by default.
            </p>

            <div style={{
              border: `1px solid ${COL.line}`, background: COL.bgSoft,
              padding: '22px 26px',
              display: 'grid', gridTemplateColumns: '20px 1fr', gap: 18,
            }}>
              <div style={{ width: 2, background: COL.red, alignSelf: 'stretch' }}/>
              <div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COL.fgDim, marginBottom: 8 }}>
                  claude-code · issue #15897
                </div>
                <div style={{ fontSize: 14.5, color: COL.fg, lineHeight: 1.55 }}>
                  "All hooks run in parallel. There is no ordering guarantee, no way to
                  chain modifications, no way to know which one blocked."
                </div>
              </div>
            </div>
          </div>

          {/* Broken hook + transcript */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <CodeCard
              title="no-rm-rf.sh"
              badge="bash"
              badgeColor={COL.fgDim}
              lines={brokenHookLines}
              compact
            />

            <div style={{
              background: COL.bgCode, border: `1px solid ${COL.line}`,
              fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, lineHeight: 1.6,
              color: COL.fg,
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
                  <span style={{ color: accent }}>PreToolUse</span>
                  <span style={{ color: COL.red }}>exit 127</span>
                </div>
              </div>
              <div style={{ padding: '14px 16px' }}>
                <div>
                  <span style={{ color: accent, marginRight: 8 }}>❯</span>
                  <span>clean up stale artifacts</span>
                </div>
                <div style={{ height: 6 }}/>
                <div>
                  <span style={{ color: accent, marginRight: 8 }}>●</span>
                  <span>Removing them now.</span>
                </div>
                <div style={{ color: COL.fgDim, paddingLeft: 16 }}>
                  Bash · <span style={{ color: COL.fgMute }}>rm -rf /tmp/build ~</span>
                </div>
                <div style={{ color: COL.red, paddingLeft: 16 }}>
                  {'  ⎿  '}Hook execution failed: <span style={{ color: COL.fg }}>rg: command not found</span>
                </div>
                <div style={{ color: COL.fgDim, paddingLeft: 16 }}>
                  {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> removed /tmp/build
                </div>
                <div style={{ height: 6 }}/>
                <div>
                  <span style={{ color: accent, marginRight: 8 }}>●</span>
                  <span style={{ color: COL.red }}>Done — and cleared your home directory too.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`,
          borderTop: `1px solid ${COL.line}`,
        }}>
          {pains.map((p, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const totalRows = Math.ceil(pains.length / cols);
            return (
              <div key={p.n} style={{
                padding: vp.isMobile ? '24px 0' : '28px 28px 28px 0',
                borderRight: col !== cols - 1 && !vp.isMobile ? `1px solid ${COL.line}` : 'none',
                borderBottom: row < totalRows - 1 ? `1px solid ${COL.line}` : 'none',
                paddingLeft: col === 0 || vp.isMobile ? 0 : 28,
              }}>
                <div style={{
                  fontSize: 12, color: accent, marginBottom: 10,
                  fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.5,
                }}>
                  {p.n} — {p.k}
                </div>
                <p style={{ fontSize: 14.5, lineHeight: 1.55, color: COL.fgMute, margin: 0 }}>{p.d}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------- Hook API anatomy ----------
function HookAnatomySection({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;
  const items = [
    { n: '01', k: 'meta', hl: 'meta',
      d: 'A name and optional description.' },
    { n: '02', k: 'Lifecycle: beforeHook', hl: 'lifecycle',
      d: 'Optional. Runs before every event method on this hook. Return event.respond(...) to short-circuit with a tagged result — otherwise fall through to the event method.' },
    { n: '03', k: 'Event methods', hl: 'events',
      d: 'One method per event. Define the method to subscribe. 22 events available.' },
    { n: '04', k: 'Typed ctx, tagged result', hl: 'result',
      d: 'ctx is narrowed per event. Return { result: "allow" | "block" | "skip" | "updateInput" } — or "ask" | "defer" on PreToolUse. Unknown values are treated as failures.' },
  ];
  // Line indices into anatomyLines below, keyed by item.hl
  const HL = {
    meta:      [5, 6, 7, 8],
    lifecycle: [10, 11, 12, 13, 14],
    events:    [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    result:    [16, 22, 23, 24, 25, 26, 27, 28, 29],
  };
  const [hovered, setHovered] = React.useState(null);
  const hlSet = new Set(hovered ? HL[hovered] : []);
  const anatomyLines = [
    [[TK.com, '// .clooks/hooks/no-bare-mv.ts']],
    [[TK.kw, 'import'], [TK.op, ' { '], [TK.fn, 'existsSync'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'fs'"]],
    [[TK.kw, 'import type'], [TK.op, ' { '], [TK.ty, 'ClooksHook'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'clooks'"]],
    '',
    [[TK.kw, 'export const'], [TK.fn, ' hook'], [TK.op, ': '], [TK.ty, 'ClooksHook'], [TK.op, ' = {']],
    ['  ', [TK.prop, 'meta'], [TK.op, ': {']],
    ['    ', [TK.prop, 'name'], [TK.op, ': '], [TK.str, "'no-bare-mv'"], [TK.op, ',']],
    ['    ', [TK.prop, 'description'], [TK.op, ': '], [TK.str, "'Rewrite bare mv to git mv.'"], [TK.op, ',']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'beforeHook'], [TK.op, '('], [TK.ty, 'event'], [TK.op, ') {'], '  ', [TK.com, '// runs before every event method']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (!'], [TK.fn, 'existsSync'], [TK.op, '('], [TK.str, "'.git'"], [TK.op, ')) {']],
    ['      ', [TK.kw, 'return'], [TK.op, ' event.'], [TK.fn, 'respond'], [TK.op, '({ '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' })']],
    ['    ', [TK.op, '}']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'PreToolUse'], [TK.op, '('], [TK.ty, 'ctx'], [TK.op, ') {']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (ctx.'], [TK.prop, 'toolName'], [TK.op, ' !== '], [TK.str, "'Bash'"], [TK.op, ') '], [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    '',
    ['    ', [TK.kw, 'const'], [TK.fn, ' cmd'], [TK.op, ' = '], [TK.ty, 'String'], [TK.op, '(ctx.'], [TK.prop, 'toolInput'], [TK.op, '.command ?? '], [TK.str, "''"], [TK.op, ')']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (!/^\\s*mv\\b/.test(cmd)) '], [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    '',
    ['    ', [TK.kw, 'return'], [TK.op, ' {']],
    ['      ', [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'updateInput'"], [TK.op, ',']],
    ['      ', [TK.prop, 'updatedInput'], [TK.op, ': {']],
    ['        ', [TK.op, '...ctx.'], [TK.prop, 'toolInput'], [TK.op, ',']],
    ['        ', [TK.prop, 'command'], [TK.op, ': cmd.'], [TK.fn, 'replace'], [TK.op, '(/^\\s*mv\\b/, '], [TK.str, "'git mv'"], [TK.op, '),']],
    ['      ', [TK.op, '},']],
    ['      ', [TK.prop, 'note'], [TK.op, ': '], [TK.str, "'rewrote mv → git mv'"], [TK.op, ',']],
    ['    ', [TK.op, '}']],
    ['  ', [TK.op, '},']],
    [[TK.op, '}']],
  ];

  return (
    <section id="hook" style={{
      padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
      borderBottom: `1px solid ${COL.line}`, background: COL.bgElev,
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Hook API</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 780,
        }}>
          A hook is an object.<br/>
          <span style={{ color: COL.fgMute }}>One file. One or more hooks.</span>
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 56px', lineHeight: 1.6 }}>
          Each file exports one or more <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>ClooksHook</code> objects.
          Every event you handle is a method with a typed context and a typed return. Config is validated with Zod and merged over your defaults.
          Hover a row below to see where it lives in the source.
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
              <div style={{ display: 'flex', padding: '14px 0' }}>
                <div style={{
                  padding: vp.isMobile ? '0 8px' : '0 12px', color: COL.fgFaint, textAlign: 'right',
                  borderRight: `1px solid ${COL.line}`, userSelect: 'none',
                  minWidth: vp.isMobile ? 28 : 36,
                }}>
                  {anatomyLines.map((_, i) => (
                    <div key={i} style={{
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
                        minHeight: vp.isMobile ? 17 : 20.6,
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
            </div>
          </div>
          <div>
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

      </div>
    </section>
  );
}

// ---------- Config: .clooks/ layout + clooks.yml ----------
function ConfigSection({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;
  const treeLines = [
    [[TK.fn, 'your-project/']],
    [[TK.op, '├── '], [TK.fn, '.clooks/']],
    [[TK.op, '│   ├── '], [TK.prop, 'clooks.yml'],                 [TK.com, '             # hooks + config']],
    [[TK.op, '│   ├── '], [TK.prop, 'clooks.schema.json'],         [TK.com, '     # editor validation']],
    [[TK.op, '│   ├── '], [TK.prop, 'hooks.lock'],                 [TK.com, '             # pinned SHAs (committed)']],
    [[TK.op, '│   ├── '], [TK.fn, 'bin/entrypoint.sh'],             [TK.com, '      # registered in .claude/settings.json']],
    [[TK.op, '│   ├── '], [TK.fn, 'hooks/'],                        [TK.com, '                 # your .ts hooks']],
    [[TK.op, '│   │   ├── '], [TK.prop, 'no-rm-rf.ts']],
    [[TK.op, '│   │   ├── '], [TK.prop, 'log-bash-commands.ts']],
    [[TK.op, '│   │   └── '], [TK.prop, 'types.d.ts'],              [TK.com, '             # generated']],
    [[TK.op, '│   └── '], [TK.fn, 'vendor/'],                       [TK.com, '                # installed marketplace hooks']],
    [[TK.op, '│       ├── '], [TK.fn, 'clooks-core-hooks/']],
    [[TK.op, '│       │   ├── '], [TK.prop, 'no-bare-mv.ts']],
    [[TK.op, '│       │   └── '], [TK.prop, 'tmux-notifications.ts']],
    [[TK.op, '│       └── '], [TK.fn, 'clooks-project-hooks/']],
    [[TK.op, '│           └── '], [TK.prop, 'js-package-manager-guard.ts']],
    [[TK.op, '└── '], [TK.fn, '.claude/settings.json'],             [TK.com, '    # auto-managed']],
  ];

  const ymlLines = [
    [[TK.prop, 'version'], [TK.op, ': '], [TK.str, '"1.0.0"']],
    '',
    [[TK.prop, 'config'], [TK.op, ':']],
    ['  ', [TK.prop, 'timeout'], [TK.op, ': '], [TK.num, '30000']],
    ['  ', [TK.prop, 'onError'], [TK.op, ': '], [TK.str, '"block"'], '  ', [TK.com, '# or "continue" | "trace"']],
    ['  ', [TK.prop, 'maxFailures'], [TK.op, ': '], [TK.num, '3']],
    '',
    [[TK.prop, 'no-rm-rf'], [TK.op, ': {}']],
    '',
    [[TK.prop, 'log-bash-commands'], [TK.op, ':']],
    ['  ', [TK.prop, 'config'], [TK.op, ':']],
    ['    ', [TK.prop, 'logDir'], [TK.op, ': '], [TK.str, '"logs"']],
    ['  ', [TK.prop, 'parallel'], [TK.op, ': '], [TK.num, 'true']],
    ['  ', [TK.prop, 'onError'], [TK.op, ': '], [TK.str, '"continue"']],
    '',
    [[TK.prop, 'PreToolUse'], [TK.op, ':']],
    ['  ', [TK.prop, 'order'], [TK.op, ':']],
    ['    - ', [TK.str, 'no-rm-rf']],
    ['    - ', [TK.str, 'log-bash-commands']],
  ];

  return (
    <section id="config" style={{
      padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
      borderBottom: `1px solid ${COL.line}`,
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Config</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 780,
        }}>
          Everything lives in <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85em' }}>.clooks/</code>.<br/>
          <span style={{ color: COL.fgMute }}>Committed with the rest of your code.</span>
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 48px', lineHeight: 1.6 }}>
          <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>clooks init</code> writes a
          self-contained folder. Only the entrypoint script is registered into
          <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}> .claude/settings.json</code>.
          A teammate cloning the repo gets the same hooks at the same SHAs.
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: stack ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: stack ? 28 : 32,
        }}>
          <div>
            <div style={{
              fontSize: 11, color: COL.fgDim, marginBottom: 10,
              fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1, textTransform: 'uppercase',
            }}>After clooks init</div>
            <CodeCard lines={treeLines} lineNumbers={false}/>
          </div>
          <div>
            <div style={{
              fontSize: 11, color: COL.fgDim, marginBottom: 10,
              fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1, textTransform: 'uppercase',
            }}>.clooks/clooks.yml</div>
            <CodeCard lines={ymlLines} lineNumbers={false}/>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Install flow (replaces old Quickstart) ----------
function InstallSection({ accent, tweaks }) {
  const vp = useViewport();
  const stack = vp.isMobile;
  const [path, setPath] = React.useState('plugin');

  const paths = {
    plugin: {
      label: 'Plugin (fastest)',
      blurb: 'Install through the Claude Code plugin system. The plugin is a bootstrap — it registers a SessionStart hook that tells Claude to run /clooks:setup, which downloads the binary and runs clooks init in your project.',
      steps: [
        { t: 'Add the marketplace',
          cmd: 'claude plugin marketplace add codestripes-dev/clooks-marketplace',
          d: 'A separate repo that hosts plugin metadata and points at source.' },
        { t: 'Install the clooks plugin',
          cmd: 'claude plugin install clooks@clooks-marketplace',
          d: 'Bootstrap only. Drops a SessionStart hook and the /clooks:setup skill. Does not put the runtime on PATH — reload Claude Code to activate.' },
        { t: 'Run /clooks:setup',
          cmd: '/clooks:setup',
          d: 'Runs inside Claude Code. Downloads the latest release binary for your platform, places it on PATH, and runs clooks init in the current project.',
          slash: true },
        { t: 'Optional — install a hook pack',
          cmd: 'claude plugin install clooks-core-hooks --scope user',
          d: 'Six ready-made safety and quality hooks, including no-rm-rf. Use --scope user to apply them everywhere on this machine; use --scope project to commit the plugin entry to this repo so teammates get it too.' },
      ],
    },
    binary: {
      label: 'Manual binary',
      blurb: 'Install the runtime yourself. The plugin path automates these same steps; the result is the same.',
      steps: [
        { t: 'Download the binary',
          cmd: 'open https://github.com/codestripes-dev/clooks/releases/latest',
          d: 'Prebuilt for darwin-arm64, darwin-x64, linux-x64, linux-x64-baseline, linux-arm64. Grab the binary for your platform, chmod +x it, drop it on your PATH.' },
        { t: 'Initialize in your repo',
          cmd: 'clooks init',
          d: 'Writes .clooks/ (clooks.yml, schema, entrypoint.sh, hooks/types.d.ts), updates .gitignore, registers the entrypoint in .claude/settings.json (project). Safe to re-run.' },
        { t: 'Commit',
          cmd: 'git add .clooks .claude/settings.json && git commit -m "add clooks"',
          d: 'Everything you need is in the repo. A teammate cloning just needs the binary.' },
      ],
    },
    clone: {
      label: 'Cloning a repo',
      blurb: 'Somebody on your team already ran init and committed .clooks/. You just need the runtime.',
      steps: [
        { t: 'Clone a repo that already uses clooks',
          cmd: 'git clone <repo> && cd <repo>',
          d: '.clooks/bin/entrypoint.sh and .claude/settings.json are already committed. The project hook config comes with the repo.' },
        { t: 'Open it in Claude Code',
          cmd: 'claude',
          d: 'If clooks-marketplace and the clooks plugin are declared as a project-level Claude dependency, you\'ll be prompted automatically to run /clooks:setup on first session.' },
        { t: 'Run /clooks:setup',
          cmd: '/clooks:setup',
          d: 'Pulls the runtime binary for your platform and wires it into this checkout. If you missed the prompt above, run it manually — idempotent, safe to re-run.',
          slash: true },
        { t: 'Install the binary',
          cmd: '# Fallback: github.com/codestripes-dev/clooks/releases/latest',
          d: 'If you\'re not using the plugin — grab the binary from GitHub releases and put it on PATH.',
          comment: true },
      ],
    },
  };

  const active = paths[path];

  return (
    <section id="install" style={{
      padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
      borderBottom: `1px solid ${COL.line}`,
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Install</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 780,
        }}>
          Three ways to install.
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 40px', lineHeight: 1.6 }}>
          Each ends the same way: a committed <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>.clooks/</code> directory and the Clooks binary on your PATH.
        </p>

        <div style={{
          display: 'flex', gap: 0, marginBottom: 0,
          borderBottom: `1px solid ${COL.line}`,
        }}>
          {Object.entries(paths).map(([key, p]) => (
            <button key={key} onClick={() => setPath(key)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: vp.isMobile ? '10px 8px 12px' : '12px 20px 14px',
              fontSize: vp.isMobile ? 12 : 13, fontFamily: 'inherit',
              whiteSpace: 'nowrap',
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
            <div key={i} style={{
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
                  {s.d}
                </div>
                {(stack || vp.isTablet) && (
                  <div style={{ marginTop: 14 }}>
                    <CmdBox accent={accent} cmd={s.cmd} slash={s.slash} comment={s.comment}/>
                  </div>
                )}
              </div>
              {!stack && !vp.isTablet && (
                <CmdBox accent={accent} cmd={s.cmd} slash={s.slash} comment={s.comment}/>
              )}
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${COL.line}` }}/>
        </div>

        <div style={{
          marginTop: 40, padding: '20px 24px',
          background: COL.bgSoft, border: `1px solid ${COL.line}`,
          display: 'grid',
          gridTemplateColumns: stack ? '1fr' : '60px 1fr',
          gap: stack ? 10 : 16, alignItems: 'start',
        }}>
          <span style={{
            color: accent, fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', paddingTop: 2,
          }}>Heads up</span>
          <div style={{ fontSize: 14, color: COL.fgMute, lineHeight: 1.65 }}>
            Global mode: add <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>clooks init --global</code> to register hooks under <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>~/.clooks/</code> for every Claude Code session.
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Comparison table ----------
function ComparisonSection({ accent }) {
  const rows = [
    ['Failure mode',           'Lets the action through on anything but exit 2', 'Blocks the action when a hook errors (configurable)'],
    ['Language',               'Bash strings in JSON',                        'TypeScript, typed end to end'],
    ['Composition',            'All hooks parallel, no ordering',             'Parallel or sequential with explicit order'],
    ['Input modification',     'Not supported',                               'Sequential pipeline; hooks see previous updatedInput'],
    ['Retries',                'Per invocation only',                         'Circuit breaker auto-disables after N failures'],
    ['Distribution',           'Copy-paste from gists',                       'Marketplace, SHA-pinned, lockfile-verified'],
    ['Portability',            'Lives in your settings',                      'Vendored into .clooks/, committed'],
  ];
  const vp = useViewport();
  const stack = vp.isMobile;
  return (
    <section style={{
      padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
      borderBottom: `1px solid ${COL.line}`, background: COL.bgElev,
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>vs. native hooks</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 40px', maxWidth: 640,
        }}>
          Clooks vs. native hooks.
        </h2>
        <div style={{ border: `1px solid ${COL.line}` }}>
          {!stack && (
            <div style={{
              display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1.6fr',
              padding: '14px 20px', borderBottom: `1px solid ${COL.line}`,
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
              letterSpacing: 1, textTransform: 'uppercase', color: COL.fgDim,
              background: COL.bgSoft,
            }}>
              <span/>
              <span>Native hooks</span>
              <span style={{ color: accent }}>Clooks</span>
            </div>
          )}
          {rows.map(([k, a, b], i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: stack ? '1fr' : '1.2fr 1.4fr 1.6fr',
              padding: stack ? '22px 18px' : '18px 20px',
              borderBottom: i < rows.length - 1 ? `1px solid ${COL.line}` : 'none',
              fontSize: 14, alignItems: 'start', gap: stack ? 0 : 0,
            }}>
              <span style={{
                color: COL.fg,
                fontWeight: stack ? 600 : 500,
                fontSize: stack ? 17 : 14,
                letterSpacing: stack ? -0.2 : 0,
                marginBottom: stack ? 14 : 0,
              }}>{k}</span>
              {stack ? (
                <>
                  <div style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: 1,
                    textTransform: 'uppercase', color: COL.fgFaint,
                    borderLeft: `2px solid ${COL.lineStrong}`, paddingLeft: 10, marginBottom: 4,
                  }}>Native</div>
                  <span style={{
                    color: COL.fgMute,
                    borderLeft: `2px solid ${COL.lineStrong}`, paddingLeft: 10,
                    display: 'block', paddingBottom: 14,
                  }}>{a}</span>
                  <div style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: 1,
                    textTransform: 'uppercase', color: COL.fgFaint,
                    borderLeft: `2px solid ${accent}`, paddingLeft: 10, marginBottom: 4,
                  }}>Clooks</div>
                  <span style={{
                    color: COL.fg,
                    borderLeft: `2px solid ${accent}`, paddingLeft: 10,
                    display: 'block',
                  }}>{b}</span>
                </>
              ) : (
                <>
                  <span style={{ color: COL.fgMute }}>{a}</span>
                  <span style={{ color: COL.fg }}>{b}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------- Why not a plugin? ----------
function WhyNotPluginSection({ accent }) {
  const vp = useViewport();
  return (
    <section style={{
      padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
      borderBottom: `1px solid ${COL.line}`,
    }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <SectionLabel accent={accent}>On the plugin system</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 24px',
        }}>
          Why isn't Clooks <em style={{ fontStyle: 'italic', color: COL.fgMute }}>just</em> a Claude Code plugin?
        </h2>
        <p style={{ fontSize: 16, color: COL.fgMute, lineHeight: 1.65, margin: '0 0 16px' }}>
          Clooks uses the plugin system for distribution. The runtime itself lives outside the plugin sandbox.
        </p>
        <p style={{ fontSize: 16, color: COL.fgMute, lineHeight: 1.65, margin: 0 }}>
          A plugin <em>can</em> quietly download and install binaries on your machine, then wire them into your agent. You shouldn't be surprised by a binary landing on your machine just because you cloned a repo or installed a plugin. Clooks keeps that surface visible — the bash entrypoint sits in <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>.claude/settings.json</code>, the <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>.clooks/</code> directory is committed alongside your code, and pulling the runtime binary is an explicit step, not something the plugin does behind your back.
        </p>
      </div>
    </section>
  );
}

// ---------- Roadmap ----------
function RoadmapSection({ accent }) {
  const items = [
    { k: 'Claude Code', status: 'shipping', note: 'primary target, working today' },
    { k: 'clooks test', status: 'wip', note: 'runner in progress — co-located .test.ts files today' },
    { k: 'clooks manage (TUI)', status: 'planned', note: 'interactive marketplace browser' },
    { k: 'curl | sh installer', status: 'planned', note: 'clooks.cc/install — plugin path works today' },
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
    <section style={{
      padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
      borderBottom: `1px solid ${COL.line}`, background: COL.bgElev,
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Roadmap</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 40px', maxWidth: 640,
        }}>
          Where things stand at <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85em' }}>v0.0.1</code>.
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

// ---------- FAQ ----------
function FAQSection({ accent }) {
  const vp = useViewport();
  const faqs = [
    {
      q: 'Why not just write bash?',
      a: 'Bash is great for 3 lines. Past that you want imports, types, and tests — and you want them to keep working when the agent does something surprising. Clooks gives you TypeScript with typed event contracts; you can still shell out from inside a hook.',
    },
    {
      q: 'Why Bun?',
      a: 'Compiled static binaries, fast startup, TypeScript without a build step. The runtime needs to cost nothing on every tool call — and it needs to be a single file that a plugin install can drop onto your PATH. Bun ticks both.',
    },
    {
      q: 'What happens when a hook crashes?',
      a: 'Default is onError: "block" — the action is refused and the agent is told why. Configurable per-hook to "continue" (pass through) or "trace" (log and continue). After three consecutive failures the hook is auto-disabled; a success resets the counter.',
    },
    {
      q: 'Is there a registry of hooks I can browse?',
      a: 'We only have two core sets of Claude hooks right now — clooks-core-hooks and clooks-project-hooks, both living in codestripes-dev/clooks-marketplace. However, everyone can create their own clooks-hooks repositories and marketplaces Feel free to open up PRs if you have further hooks you\'d like to see added!',
    },
    {
      q: 'What about other agents — Cursor, Codex, OpenCode, OpenClaw?',
      a: 'Planned. We\'d like clooks to be cross-agent down the line, but we need to research how to fit all APIs under one umbrella first.',
    },
  ];
  return (
    <section id="faq" style={{
      padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
      borderBottom: `1px solid ${COL.line}`,
    }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <SectionLabel accent={accent}>FAQ</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 40px',
        }}>
          Common questions.
        </h2>
        <div>
          {faqs.map((f, i) => <FAQItem key={i} q={f.q} a={f.a} accent={accent} last={i === faqs.length - 1}/>)}
        </div>
      </div>
    </section>
  );
}

function FAQItem({ q, a, accent, last }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{
      borderTop: `1px solid ${COL.line}`,
      borderBottom: last ? `1px solid ${COL.line}` : 'none',
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', background: 'transparent', border: 'none', color: COL.fg,
        padding: '22px 0', textAlign: 'left', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 16, fontWeight: 500,
      }}>
        <span>{q}</span>
        <span style={{
          color: accent, fontFamily: 'JetBrains Mono, monospace', fontSize: 18,
          width: 18, textAlign: 'center',
        }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={{
          padding: '0 0 24px', fontSize: 15, color: COL.fgMute,
          lineHeight: 1.65, maxWidth: 680,
        }}>{a}</div>
      )}
    </div>
  );
}

// ---------- Footer ----------
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
            clooks v0.0.1 · built with bun · by Joe Degler
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
        <span>© {new Date().getFullYear()} Joe Degler</span>
      </div>
    </footer>
  );
}

// ---------- Captures: three annotated TUI transcripts ----------
function CapturesSection({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;
  const [active, setActive] = React.useState(0);

  // Token shorthands for terminal lines. Each line is an array of
  // [kind, text] segments. Kinds: 'u' user prompt, 'd' dim/meta,
  // 'r' red/error, 'g' green/ok, 'a' accent, 'y' yellow-warning,
  // 'f' plain fg, 'mono' mono same-as-f, 'm' muted.
  const captures = [
    {
      id: 'block',
      tab: '01 · Intended block',
      title: 'A hook refuses a destructive command.',
      blurb: <>The <code style={codeInline}>no-rm-rf</code> hook returns <code style={codeInline}>{`{ result: "block", reason }`}</code>. Claude reads the reason, stops, and surfaces it back to the user.</>,
      meta: [
        ['PreToolUse', accent], ['Bash', 'fg'],
      ],
      lines: [
        [['a', '❯ '], ['f', 'Use the Bash tool to clear stale cache by running: '], ['mono', 'rm -rf /tmp/stale-cache-demo']],
        null,
        [['d', '  Ran 1 bash command']],
        [['d', '  ⎿  '], ['r', 'PreToolUse:Bash hook returned blocking error']],
        [['d', '  ⎿  '], ['f', 'Blocked '], ['mono', '`rm -rf`'], ['f', ' by policy. Ask the user to run destructive deletes manually.']],
        null,
        [['a', '● '], ['f', 'A hook blocked the '], ['mono', 'rm -rf'], ['f', ' command by policy. Please run it manually:']],
        [['f', '  '], ['mono', 'rm -rf /tmp/stale-cache-demo']],
      ],
      annotations: [
        { label: 'Clooks output', color: accent, note: 'reason string from the hook appears as the blocking error' },
        { label: 'Claude\'s reply', color: COL.green, note: 'reads the reason and relays it back to the user unprompted' },
      ],
    },
    {
      id: 'crash',
      tab: '02 · Crash, blocked',
      title: 'A hook crashes. The action is blocked.',
      blurb: <>With <code style={codeInline}>onError: "block"</code> — the default — a runtime error aborts the tool call. The stack trace travels back in the hook output.</>,
      meta: [
        ['onError: block', accent], ['TypeError', 'red'],
      ],
      lines: [
        [['a', '❯ '], ['f', 'Use the Bash tool to run exactly this command, nothing else: '], ['mono', 'eslint src/']],
        null,
        [['d', '  Ran 1 bash command']],
        [['d', '  ⎿  '], ['r', 'PreToolUse:Bash hook returned blocking error']],
        [['d', '  ⎿  '], ['mono', '[clooks] Hook "crashy-linter" failed on PreToolUse']],
        [['d', '     '], ['mono', "(TypeError: undefined is not an object (evaluating '(void 0)[0]'))."]],
        [['d', '     '], ['r', 'Action blocked (onError: block).']],
        null,
        [['a', '● '], ['f', 'The "crashy-linter" hook crashed with a TypeError and blocked']],
        [['f', '  the tool call.']],
      ],
      annotations: [
        { label: 'Structured failure', color: accent, note: 'hook name, event, exception class, message — all captured' },
        { label: 'Blocked on crash', color: COL.red, note: 'tool call refused, and the agent is told why.' },
      ],
    },
    {
      id: 'trace',
      tab: '03 · onError: trace',
      title: 'A broken hook warns instead of blocking.',
      blurb: <>A hook marked <code style={codeInline}>onError: "trace"</code> injects its failure into <code style={codeInline}>additionalContext</code>, allows the action, and Claude narrates the error back to the user unprompted.</>,
      meta: [
        ['onError: trace', accent], ['SyntaxError', 'yellow'],
      ],
      lines: [
        [['a', '❯ '], ['f', 'Use the Bash tool to run exactly this command, nothing else: '], ['mono', 'debug-me --now']],
        null,
        [['a', '● '], ['f', 'Running the command now.']],
        null,
        [['d', '  Ran 1 bash command']],
        null,
        [['a', '● '], ['f', 'The hook '], ['mono', 'broken-dev-hook'], ['f', ' errored with SyntaxError: JSON Parse error:']],
        [['f', '  Expected \'}\' but was configured as '], ['mono', 'onError: trace'], ['f', ', so it did not']],
        [['f', '  block the action. The command itself failed separately — '], ['mono', 'debug-me']],
        [['f', '  was not found on the PATH.']],
      ],
      annotations: [
        { label: 'Failure as context', color: accent, note: 'hook failures surface in the agent loop, formatted for the model' },
        { label: 'Context injection', color: COL.green, note: 'the error becomes context the agent can reason about' },
      ],
    },
  ];

  const cap = captures[active];

  return (
    <section id="captures" style={{
      padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
      borderBottom: `1px solid ${COL.line}`, background: COL.bgElev,
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Captures</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 820,
        }}>
          Three scenarios.
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 680, margin: '0 0 36px', lineHeight: 1.6 }}>
          Recorded from a Claude Code session.
        </p>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 0, marginBottom: 28,
        }}>
          {captures.map((c, i) => (
            <button key={c.id} onClick={() => setActive(i)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: vp.isMobile ? '10px 6px 12px' : '12px 20px 14px',
              fontSize: vp.isMobile ? 11 : 13, fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              color: active === i ? COL.fg : COL.fgMute,
              borderBottom: `2px solid ${active === i ? accent : 'transparent'}`,
              letterSpacing: 0.2,
              flex: vp.isMobile ? '1 1 0' : '0 0 auto',
              textAlign: vp.isMobile ? 'center' : 'left',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>{c.tab}</button>
          ))}
        </div>

        {/* Title + blurb */}
        <div style={{ marginBottom: 24, maxWidth: 760 }}>
          <div style={{
            fontSize: 22, color: COL.fg, fontWeight: 500, letterSpacing: -0.3,
            marginBottom: 10,
          }}>
            {cap.title}
          </div>
          <div style={{ fontSize: 14.5, color: COL.fgMute, lineHeight: 1.6 }}>
            {cap.blurb}
          </div>
        </div>

        {/* Main two-column: terminal on the left, annotations on the right */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: stack ? 'minmax(0, 1fr)' : 'minmax(0, 1.6fr) minmax(0, 1fr)',
          gap: stack ? 24 : 32,
          alignItems: 'start',
        }}>
          <TerminalTranscript cap={cap} accent={accent}/>
          <div>
            <div style={{
              fontSize: 11, color: COL.fgDim, letterSpacing: 1,
              textTransform: 'uppercase', marginBottom: 14,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              What to look at
            </div>
            {cap.annotations.map((a, i) => (
              <div key={i} style={{
                padding: '16px 0', borderTop: `1px solid ${COL.line}`,
                display: 'grid', gridTemplateColumns: '14px 1fr', gap: 12,
                alignItems: 'start',
              }}>
                <div style={{
                  width: 8, height: 8, background: a.color, marginTop: 7,
                }}/>
                <div>
                  <div style={{ fontSize: 13, color: COL.fg, fontWeight: 500, marginBottom: 4 }}>
                    {a.label}
                  </div>
                  <div style={{ fontSize: 13, color: COL.fgMute, lineHeight: 1.55 }}>
                    {a.note}
                  </div>
                </div>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${COL.line}`, marginTop: 0 }}/>
          </div>
        </div>
      </div>
    </section>
  );
}

const codeInline = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '0.88em',
  color: '#f5f5f2',
  background: 'rgba(255,255,255,0.05)',
  padding: '1px 6px',
  borderRadius: 0,
};

function TerminalTranscript({ cap, accent }) {
  const vp = useViewport();
  const colorFor = (k) => ({
    a: accent,
    d: COL.fgDim,
    m: COL.fgMute,
    r: COL.red,
    g: COL.green,
    y: COL.yellow,
    f: COL.fg,
    mono: COL.fg,
  }[k] || COL.fg);
  const fontFor = (k) => (k === 'mono' ? 'JetBrains Mono, monospace' : 'inherit');

  return (
    <div style={{
      background: COL.bgCode, border: `1px solid ${COL.line}`,
      fontFamily: 'JetBrains Mono, monospace', fontSize: vp.isMobile ? 9 : 13, lineHeight: 1.6,
    }}>
      {/* Title bar */}
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
          {cap.meta.map(([label, tone], i) => {
            const c = tone === 'red' ? COL.red
              : tone === 'yellow' ? COL.yellow
              : tone === 'dim' ? COL.fgDim
              : tone === 'fg' ? COL.fgMute
              : tone; // accent string
            return (
              <span key={i} style={{ color: c, letterSpacing: 0.3 }}>{label}</span>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '18px 18px 22px', color: COL.fg }}>
        {cap.lines.map((ln, i) => (
          <div key={i} style={{ minHeight: ln === null ? 10 : undefined, whiteSpace: 'pre-wrap' }}>
            {ln === null ? '\u00a0' : ln.map(([k, t], j) => (
              <span key={j} style={{ color: colorFor(k), fontFamily: fontFor(k) }}>{t}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Hook demos: showcase third-party hooks and their visual effects ----------
// First demo: tmux-notifications — visual tmux indicators for session state.
// Three tmux status-bar vignettes (idle / permission / reset) next to the hook
// source. Scenes auto-advance; hover to pause. Permission flash is animated.

function TmuxWindowBar({ windows, flash = 0, paneDim = false, paneContent, accent }) {
  // windows: [{ id, name, active, style: 'default'|'idleRed'|'alert' }]
  // flash: 0..1 intensity for the permission-prompt pane flash
  const paneBg = flash > 0 ? '#2a2a2a' : (paneDim ? '#0b0b0b' : '#0a0a0a');
  return (
    <div style={{
      background: paneBg,
      border: `1px solid ${COL.line}`,
      fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
      transition: 'background 120ms linear',
      display: 'flex', flexDirection: 'column',
      minHeight: 200,
    }}>
      {/* Claude Code pane content */}
      <div style={{ flex: 1, padding: '12px 14px 14px', color: COL.fgMute, fontSize: 12, lineHeight: 1.55 }}>
        {paneContent}
      </div>
      {/* tmux status bar */}
      <div style={{
        background: '#1a1a1a', borderTop: `1px solid ${COL.line}`,
        padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 11, color: COL.fgDim,
      }}>
        <span style={{ color: '#84cc16', fontWeight: 600 }}>[work]</span>
        {windows.map((w, i) => {
          const active = w.active;
          let bg = 'transparent';
          let fg = COL.fgMute;
          let bold = 400;
          if (w.style === 'idleRed') { fg = COL.red; }
          if (w.style === 'alert')   { bg = COL.red; fg = '#fff'; bold = 700; }
          if (active && w.style !== 'alert') { fg = w.style === 'idleRed' ? COL.red : COL.fg; }
          return (
            <span key={i} style={{
              background: bg, color: fg, fontWeight: bold,
              padding: '2px 8px',
              transition: 'background 140ms linear, color 140ms linear',
            }}>
              {w.id}:{w.name}{active ? '*' : ''}
            </span>
          );
        })}
        <span style={{ marginLeft: 'auto', color: COL.fgFaint, fontSize: 10 }}>
          {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · 14:22
        </span>
      </div>
    </div>
  );
}

function TmuxHookSection({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;

  // Animate the permission-prompt flash (scene 2): 2 quick flickers then rest.
  const [tick, setTick] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  React.useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setTick(t => (t + 1) % 40), 80);
    return () => clearInterval(id);
  }, [paused]);

  // Flash pattern: ticks 0-2 on, 3-4 off, 5-7 on, 8-10 off, rest idle.
  const flashOn = (tick >= 0 && tick < 3) || (tick >= 5 && tick < 8);

  const [active, setActive] = React.useState(0);

  const tmuxScenes = [
    {
      id: 'idle',
      tag: '01 · Notification · idle_prompt',
      title: 'Claude is waiting.',
      desc: <>You asked a question and walked away. Claude finished and is back at the prompt. The tab turns red with a <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>⏸</code> prefix.</>,
      windows: [
        { id: 1, name: 'c-api',     active: false, style: 'default' },
        { id: 2, name: '⏸ c-clooks', active: true,  style: 'idleRed' },
        { id: 3, name: 'logs',       active: false, style: 'default' },
      ],
      flash: 0,
      paneDim: false,
      pane: (
        <>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Wired the entrypoint through <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>.clooks/bin/entrypoint.sh</code>.</span></div>
          <div style={{ color: COL.fgMute, paddingLeft: 14 }}>Ready for your next instruction — want me to add a smoke test?</div>
          <div style={{ height: 10 }}/>
          <div style={{
            border: `1px solid ${COL.lineStrong}`, padding: '8px 12px',
            color: COL.fgDim, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ color: accent }}>❯</span>
            <span style={{ color: COL.fgDim }}>Try "run the tests"</span>
            <span style={{
              display: 'inline-block', width: 6, height: 13, background: COL.fgDim,
              animation: 'blink 1s steps(1) infinite', marginLeft: -4,
            }}/>
          </div>
          <div style={{ marginTop: 6, fontSize: 10.5, color: COL.fgFaint }}>
            ? for help · / for commands
          </div>
        </>
      ),
      note: <>Tab: red text + <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>⏸</code> prefix.</>,
    },
    {
      id: 'permission',
      tag: '02 · Notification · permission_prompt',
      title: 'Claude wants permission.',
      desc: <>A tool call is blocked on your approval. The pane flashes twice and the tab flips to bold red — hard to miss from the next monitor over.</>,
      windows: [
        { id: 1, name: 'c-api',    active: false, style: 'default' },
        { id: 2, name: 'c-clooks', active: true,  style: 'alert' },
        { id: 3, name: 'logs',     active: false, style: 'default' },
      ],
      flash: flashOn ? 1 : 0,
      paneDim: flashOn,
      pane: (
        <>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>I'll commit the staged changes.</span></div>
          <div style={{ height: 10 }}/>
          <div style={{
            border: `1px solid ${COL.red}`,
            background: 'rgba(248,113,113,0.04)',
            padding: 0,
          }}>
            <div style={{
              padding: '8px 12px', borderBottom: `1px solid ${COL.lineStrong}`,
              fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase',
              color: COL.red, fontWeight: 600,
            }}>
              Permission required · Bash
            </div>
            <div style={{ padding: '10px 12px', color: COL.fg, fontSize: 12 }}>
              <div style={{ color: COL.fgMute, marginBottom: 6 }}>Run this command?</div>
              <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>
                git commit -m "wire entrypoint"
              </code>
            </div>
            <div style={{
              padding: '8px 12px', borderTop: `1px solid ${COL.line}`, display: 'flex', gap: 14,
              fontSize: 11, color: COL.fgMute,
            }}>
              <span><span style={{ color: accent }}>1</span> Yes</span>
              <span><span style={{ color: accent }}>2</span> Yes, always</span>
              <span><span style={{ color: accent }}>3</span> No, tell Claude what to do differently</span>
            </div>
          </div>
        </>
      ),
      note: <>Tab: red background, bold. Pane flashes twice.</>,
    },
    {
      id: 'reset',
      tag: '03 · UserPromptSubmit / PostToolUse',
      title: 'Work is happening.',
      desc: <>You replied, or a tool call finished. The tab resets to <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>c-clooks</code>.</>,
      windows: [
        { id: 1, name: 'c-api',    active: false, style: 'default' },
        { id: 2, name: 'c-clooks', active: true,  style: 'default' },
        { id: 3, name: 'logs',     active: false, style: 'default' },
      ],
      flash: 0,
      paneDim: false,
      pane: (
        <>
          <div style={{ color: COL.fgMute }}>
            <span style={{ color: accent }}>❯</span>{' '}
            <span style={{ color: COL.fg }}>run the tests</span>
          </div>
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Running the test suite.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>bun test</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> runtime/pipeline.test.ts <span style={{ color: COL.fgFaint }}>(14 tests)</span>
          </div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> config/schema.test.ts <span style={{ color: COL.fgFaint }}>(7 tests)</span>
          </div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: accent }}>…</span> hooks/no-rm-rf.test.ts
          </div>
        </>
      ),
      note: <>Tab resets to default.</>,
    },
  ];

  // Abridged hook source — real file adds a couple more tmux() calls
  // inside the helpers and handles SessionEnd cleanup.
  const tmuxHookLines = [
    [[TK.com, '// .clooks/hooks/tmux-notifications.ts']],
    [[TK.kw, 'import'], [TK.op, ' { '], [TK.fn, 'execSync'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'child_process'"]],
    [[TK.kw, 'import type'], [TK.op, ' { '], [TK.ty, 'ClooksHook'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'clooks'"]],
    '',
    [[TK.kw, 'const'], [TK.fn, ' SKIP'], [TK.op, ' = { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' } '], [TK.kw, 'as const']],
    [[TK.kw, 'const'], [TK.fn, ' sleep'], [TK.op, ' = (ms: '], [TK.ty, 'number'], [TK.op, ') => '], [TK.kw, 'new'], [TK.fn, ' Promise'], [TK.op, '(r => '], [TK.fn, 'setTimeout'], [TK.op, '(r, ms))']],
    '',
    [[TK.kw, 'function'], [TK.fn, ' tmux'], [TK.op, '(cmd: '], [TK.ty, 'string'], [TK.op, ') {']],
    ['  ', [TK.kw, 'try'], [TK.op, ' { '], [TK.fn, 'execSync'], [TK.op, '(`tmux ${cmd}`, { '], [TK.prop, 'stdio'], [TK.op, ': '], [TK.str, "'ignore'"], [TK.op, ' }) } '], [TK.kw, 'catch'], [TK.op, ' {}']],
    [[TK.op, '}']],
    '',
    [[TK.kw, 'function'], [TK.fn, ' getWindowId'], [TK.op, '() {']],
    ['  ', [TK.kw, 'const'], [TK.fn, ' pane'], [TK.op, ' = '], [TK.ty, 'process'], [TK.op, '.env.'], [TK.prop, 'TMUX_PANE']],
    ['  ', [TK.kw, 'if'], [TK.op, ' (!pane) '], [TK.kw, 'return null']],
    ['  ', [TK.kw, 'return'], [TK.fn, ' execSync'], [TK.op, '(`tmux display-message -t "${pane}" -p '], [TK.str, "'#{window_id}'"], [TK.op, '`, { '], [TK.prop, 'encoding'], [TK.op, ': '], [TK.str, "'utf8'"], [TK.op, ' }).trim()']],
    [[TK.op, '}']],
    '',
    [[TK.kw, 'const'], [TK.fn, ' dirName'], [TK.op, ' = () => '], [TK.ty, 'process'], [TK.op, '.cwd().split('], [TK.str, "'/'"], [TK.op, ').pop() ?? '], [TK.str, "'unknown'"]],
    '',
    [[TK.kw, 'function'], [TK.fn, ' resetWindow'], [TK.op, '(w: '], [TK.ty, 'string'], [TK.op, ') {']],
    ['  ', [TK.fn, 'tmux'], [TK.op, '(`set-window-option -t ${w} window-status-style default`)']],
    ['  ', [TK.fn, 'tmux'], [TK.op, '(`rename-window -t ${w} "c-${'], [TK.fn, 'dirName'], [TK.op, '()}"`)']],
    [[TK.op, '}']],
    '',
    [[TK.kw, 'async function'], [TK.fn, ' flashPane'], [TK.op, '() {']],
    ['  ', [TK.kw, 'const'], [TK.fn, ' pane'], [TK.op, ' = '], [TK.ty, 'process'], [TK.op, '.env.'], [TK.prop, 'TMUX_PANE']],
    ['  ', [TK.kw, 'for'], [TK.op, ' ('], [TK.kw, 'let'], [TK.fn, ' i'], [TK.op, ' = 0; i < 2; i++) {']],
    ['    ', [TK.fn, 'tmux'], [TK.op, '(`select-pane -t "${pane}" -P '], [TK.str, "'bg=colour240'"], [TK.op, '`)']],
    ['    ', [TK.kw, 'await'], [TK.fn, ' sleep'], [TK.op, '(150); '], [TK.fn, 'tmux'], [TK.op, '(`select-pane -t "${pane}" -P '], [TK.str, "'bg=default'"], [TK.op, '`)']],
    ['    ', [TK.kw, 'await'], [TK.fn, ' sleep'], [TK.op, '(100)']],
    ['  ', [TK.op, '}']],
    [[TK.op, '}']],
    '',
    [[TK.kw, 'let'], [TK.fn, ' w'], [TK.op, ': '], [TK.ty, 'string']],
    '',
    [[TK.kw, 'export const'], [TK.fn, ' hook'], [TK.op, ': '], [TK.ty, 'ClooksHook'], [TK.op, ' = {']],
    ['  ', [TK.prop, 'meta'], [TK.op, ': { '], [TK.prop, 'name'], [TK.op, ': '], [TK.str, "'tmux-notifications'"], [TK.op, ' },']],
    '',
    ['  ', [TK.fn, 'beforeHook'], [TK.op, '(event) {                '], [TK.com, '// lifecycle: runs before each handler']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (!'], [TK.ty, 'process'], [TK.op, '.env.'], [TK.prop, 'TMUX'], [TK.op, ') '], [TK.kw, 'return'], [TK.op, ' event.'], [TK.fn, 'respond'], [TK.op, '('], [TK.ty, 'SKIP'], [TK.op, ')']],
    ['    ', [TK.kw, 'const'], [TK.fn, ' id'], [TK.op, ' = '], [TK.fn, 'getWindowId'], [TK.op, '()']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (!id) '], [TK.kw, 'return'], [TK.op, ' event.'], [TK.fn, 'respond'], [TK.op, '('], [TK.ty, 'SKIP'], [TK.op, ')']],
    ['    w = id'],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.kw, 'async'], [TK.fn, ' Notification'], [TK.op, '(ctx) {']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (ctx.'], [TK.prop, 'notificationType'], [TK.op, ' === '], [TK.str, "'idle_prompt'"], [TK.op, ') {']],
    ['      ', [TK.fn, 'tmux'], [TK.op, '(`set-window-option -t ${w} window-status-style '], [TK.str, "'fg=red'"], [TK.op, '`)']],
    ['      ', [TK.fn, 'tmux'], [TK.op, '(`rename-window -t ${w} "⏸ c-${'], [TK.fn, 'dirName'], [TK.op, '()}"`)']],
    ['    ', [TK.op, '} '], [TK.kw, 'else if'], [TK.op, ' (']],
    ['      ', [TK.op, 'ctx.'], [TK.prop, 'notificationType'], [TK.op, ' === '], [TK.str, "'permission_prompt'"], [TK.op, ' ||']],
    ['      ', [TK.op, 'ctx.'], [TK.prop, 'notificationType'], [TK.op, ' === '], [TK.str, "'elicitation_dialog'"]],
    ['    ', [TK.op, ') {']],
    ['      ', [TK.fn, 'tmux'], [TK.op, '(`set-window-option -t ${w} window-status-style '], [TK.str, "'bg=red,fg=white,bold'"], [TK.op, '`)']],
    ['      ', [TK.kw, 'await'], [TK.fn, ' flashPane'], [TK.op, '()']],
    ['    ', [TK.op, '}']],
    ['    ', [TK.kw, 'return'], [TK.ty, ' SKIP']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'UserPromptSubmit'], [TK.op, '() { '], [TK.fn, 'resetWindow'], [TK.op, '(w); '], [TK.kw, 'return'], [TK.ty, ' SKIP'], [TK.op, ' },']],
    ['  ', [TK.fn, 'PostToolUse'], [TK.op, '()      { '], [TK.fn, 'resetWindow'], [TK.op, '(w); '], [TK.kw, 'return'], [TK.ty, ' SKIP'], [TK.op, ' },']],
    ['  ', [TK.fn, 'SessionStart'], [TK.op, '()     { '], [TK.fn, 'resetWindow'], [TK.op, '(w); '], [TK.kw, 'return'], [TK.ty, ' SKIP'], [TK.op, ' },']],
    [[TK.op, '}']],
  ];

  // ---- demo 2: js-package-manager-guard ----
  // Heavily simplified: the real file handles compound commands, VAR= prefixes,
  // quoted strings, per-role suggestions (pm/runner/runtime), auto-extension
  // (npm→npx+node, bun→bunx), additionalBlocked, and an unconfigured-session
  // warning. Here we show only the core block flow.
  const pkgHookLines = [
    [[TK.com, '// .clooks/hooks/js-package-manager-guard.ts']],
    [[TK.kw, 'import type'], [TK.op, ' { '], [TK.ty, 'ClooksHook'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'clooks'"]],
    '',
    [[TK.kw, 'type'], [TK.ty, ' Config'], [TK.op, ' = { '], [TK.prop, 'allowed'], [TK.op, ': '], [TK.ty, 'string'], [TK.op, '[] }']],
    '',
    [[TK.kw, 'const'], [TK.fn, ' KNOWN'], [TK.op, ' = '], [TK.kw, 'new'], [TK.fn, ' Set'], [TK.op, '([']],
    ['  ', [TK.str, "'npm'"], [TK.op, ', '], [TK.str, "'npx'"], [TK.op, ', '], [TK.str, "'node'"], [TK.op, ',']],
    ['  ', [TK.str, "'yarn'"], [TK.op, ', '], [TK.str, "'pnpm'"], [TK.op, ', '], [TK.str, "'pnpx'"], [TK.op, ',']],
    ['  ', [TK.str, "'bun'"], [TK.op, ', '], [TK.str, "'bunx'"], [TK.op, ', '], [TK.str, "'deno'"], [TK.op, ',']],
    [[TK.op, '])']],
    '',
    [[TK.kw, 'const'], [TK.fn, ' firstWord'], [TK.op, ' = (cmd: '], [TK.ty, 'string'], [TK.op, ') =>']],
    ['  cmd.', [TK.fn, 'trim'], [TK.op, '().'], [TK.fn, 'split'], [TK.op, '(/\\s+/)[0] ?? '], [TK.str, "''"]],
    '',
    [[TK.kw, 'export const'], [TK.fn, ' hook'], [TK.op, ': '], [TK.ty, 'ClooksHook'], [TK.op, '<'], [TK.ty, 'Config'], [TK.op, '> = {']],
    ['  ', [TK.prop, 'meta'], [TK.op, ': {']],
    ['    ', [TK.prop, 'name'], [TK.op, ': '], [TK.str, "'js-package-manager-guard'"], [TK.op, ',']],
    ['    ', [TK.prop, 'config'], [TK.op, ': { '], [TK.prop, 'allowed'], [TK.op, ': [] },']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'PreToolUse'], [TK.op, '(ctx, config) {']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (ctx.'], [TK.prop, 'toolName'], [TK.op, ' !== '], [TK.str, "'Bash'"], [TK.op, ') '], [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    '',
    ['    ', [TK.kw, 'const'], [TK.fn, ' tool'], [TK.op, '    = '], [TK.fn, 'firstWord'], [TK.op, '('], [TK.ty, 'String'], [TK.op, '(ctx.'], [TK.prop, 'toolInput'], [TK.op, '.command ?? '], [TK.str, "''"], [TK.op, '))']],
    ['    ', [TK.kw, 'const'], [TK.fn, ' allowed'], [TK.op, ' = '], [TK.kw, 'new'], [TK.fn, ' Set'], [TK.op, '(config.'], [TK.prop, 'allowed'], [TK.op, ')']],
    '',
    ['    ', [TK.kw, 'if'], [TK.op, ' (!'], [TK.fn, 'KNOWN'], [TK.op, '.has(tool) || allowed.has(tool)) {']],
    ['      ', [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    ['    ', [TK.op, '}']],
    '',
    ['    ', [TK.kw, 'const'], [TK.fn, ' use'], [TK.op, ' = config.'], [TK.prop, 'allowed'], [TK.op, '[0] ?? '], [TK.str, "'<none>'"]],
    ['    ', [TK.kw, 'return'], [TK.op, ' {']],
    ['      ', [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'block'"], [TK.op, ',']],
    ['      ', [TK.prop, 'reason'], [TK.op, ': `This project uses '], [TK.str, "'${use}'"], [TK.op, '. Use '], [TK.str, "'${use}'"], [TK.op, ' instead of '], [TK.str, "'${tool}'"], [TK.op, '.`,']],
    ['    ', [TK.op, '}']],
    ['  ', [TK.op, '},']],
    [[TK.op, '}']],
  ];

  // Plain Claude Code pane (no tmux bar) for non-tmux scenes.
  const ccPane = (children) => (
    <div style={{
      background: COL.bgCode,
      border: `1px solid ${COL.line}`,
      fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
      color: COL.fgMute, lineHeight: 1.55,
      padding: '14px 16px', minHeight: 200,
    }}>
      {children}
    </div>
  );

  const blockBanner = (reason) => (
    <>
      <div style={{ color: COL.red }}>{'  ⎿  '}PreToolUse:Bash hook returned blocking error</div>
      <div style={{ color: COL.fg, paddingLeft: 22 }}>{reason}</div>
    </>
  );

  const pkgScenes = [
    {
      id: 'npm',
      tag: '01 · PreToolUse · Bash',
      title: 'Wrong package manager. Blocked and retried.',
      pane: (
        <>
          <div><span style={{ color: accent }}>❯</span> <span style={{ color: COL.fg }}>add react-query to the project</span></div>
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>I'll install @tanstack/react-query.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>npm install @tanstack/react-query</span></div>
          {blockBanner(<>This project uses <span style={{ color: COL.yellow }}>'bun'</span>. Use <span style={{ color: COL.yellow }}>'bun'</span> instead of <span style={{ color: COL.yellow }}>'npm'</span>.</>)}
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Got it — this project uses bun. Let me retry.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>bun add @tanstack/react-query</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> installed @tanstack/react-query@5.62.7
          </div>
        </>
      ),
      note: <>Reason string travels back. Claude self-corrects.</>,
    },
    {
      id: 'node',
      tag: '02 · PreToolUse · Bash',
      title: 'Same guard catches the runtime.',
      pane: (
        <>
          <div><span style={{ color: accent }}>❯</span> <span style={{ color: COL.fg }}>run the migration script</span></div>
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Running scripts/migrate.js.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>node scripts/migrate.js</span></div>
          {blockBanner(<>This project uses <span style={{ color: COL.yellow }}>'bun'</span>. Use <span style={{ color: COL.yellow }}>'bun'</span> instead of <span style={{ color: COL.yellow }}>'node'</span>.</>)}
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Using bun instead.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>bun scripts/migrate.js</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> Migrated 1,482 rows in 340ms
          </div>
        </>
      ),
      note: <>One rule, two symptoms — <span style={{ color: COL.fg }}>node</span> is in the known set.</>,
    },
  ];

  const mvHookLines = [
    [[TK.com, '// .clooks/hooks/no-bare-mv.ts']],
    [[TK.kw, 'import type'], [TK.op, ' { '], [TK.ty, 'ClooksHook'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'clooks'"]],
    '',
    [[TK.kw, 'const'], [TK.fn, ' startsWithMv'], [TK.op, ' = (cmd: '], [TK.ty, 'string'], [TK.op, ') =>']],
    ['  /^\\s*', [TK.str, 'mv'], [TK.op, '(\\s|$)/.test(cmd)']],
    '',
    [[TK.kw, 'export const'], [TK.fn, ' hook'], [TK.op, ': '], [TK.ty, 'ClooksHook'], [TK.op, ' = {']],
    ['  ', [TK.prop, 'meta'], [TK.op, ': {']],
    ['    ', [TK.prop, 'name'], [TK.op, ': '], [TK.str, "'no-bare-mv'"], [TK.op, ',']],
    ['    ', [TK.prop, 'description'], [TK.op, ': '], [TK.str, "'Rewrite bare mv to git mv.'"], [TK.op, ',']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'PreToolUse'], [TK.op, '(ctx) {']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (ctx.'], [TK.prop, 'toolName'], [TK.op, ' !== '], [TK.str, "'Bash'"], [TK.op, ') '], [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    ['    ', [TK.kw, 'const'], [TK.fn, ' cmd'], [TK.op, ' = '], [TK.ty, 'String'], [TK.op, '(ctx.'], [TK.prop, 'toolInput'], [TK.op, '.command ?? '], [TK.str, "''"], [TK.op, ')']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (!'], [TK.fn, 'startsWithMv'], [TK.op, '(cmd)) '], [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    '',
    ['    ', [TK.kw, 'const'], [TK.fn, ' rewritten'], [TK.op, ' = cmd.'], [TK.fn, 'replace'], [TK.op, '(/^\\s*mv\\b/, '], [TK.str, "'git mv'"], [TK.op, ')']],
    ['    ', [TK.kw, 'return'], [TK.op, ' {']],
    ['      ', [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'updateInput'"], [TK.op, ',']],
    ['      ', [TK.prop, 'updatedInput'], [TK.op, ': { ...ctx.'], [TK.prop, 'toolInput'], [TK.op, ', '], [TK.prop, 'command'], [TK.op, ': rewritten },']],
    ['      ', [TK.prop, 'note'], [TK.op, ': '], [TK.str, "'rewrote mv → git mv'"], [TK.op, ',']],
    ['    ', [TK.op, '}']],
    ['  ', [TK.op, '},']],
    [[TK.op, '}']],
  ];

  const rewriteNotice = (from, to) => (
    <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
      <span style={{ color: COL.yellow }}>clooks</span> · no-bare-mv rewrote <span style={{ color: COL.fg }}>{from}</span> → <span style={{ color: COL.fg }}>{to}</span>
    </div>
  );

  const mvScenes = [
    {
      id: 'rename',
      tag: '01 · PreToolUse · Bash',
      title: 'Bare mv, silently upgraded.',
      pane: (
        <>
          <div><span style={{ color: accent }}>❯</span> <span style={{ color: COL.fg }}>rename src/auth/login.ts to session.ts</span></div>
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>I'll rename the file.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>mv src/auth/login.ts src/auth/session.ts</span></div>
          {rewriteNotice('mv', 'git mv')}
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>git mv src/auth/login.ts src/auth/session.ts</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> renamed, history preserved
          </div>
        </>
      ),
      note: <>No block, no retry — the call runs once, already corrected.</>,
    },
    {
      id: 'multi',
      tag: '02 · PreToolUse · Bash',
      title: 'Same rewrite, same pattern.',
      pane: (
        <>
          <div><span style={{ color: accent }}>❯</span> <span style={{ color: COL.fg }}>move a.ts and b.ts into helpers/</span></div>
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Moving two files.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>mv src/util/a.ts src/util/b.ts src/helpers/</span></div>
          {rewriteNotice('mv', 'git mv')}
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>git mv src/util/a.ts src/util/b.ts src/helpers/</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> 2 files moved
          </div>
        </>
      ),
      note: <>The shell sees the rewritten command; Claude never sees a block.</>,
    },
  ];

  const demos = [
    {
      id: 'pkg',
      tab: 'js-package-manager-guard',
      filename: 'js-package-manager-guard.ts',
      pack: 'clooks-project-hooks',
      kind: 'transcript',
      hookLines: pkgHookLines,
      scenes: pkgScenes,
      elided: <>Simplified for display.</>,
      heading: <>Block with a reason,<br/><span style={{ color: COL.fgMute }}>let Claude retry.</span></>,
      lead: <><code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>js-package-manager-guard</code> stops Claude from reaching for the wrong package manager. The block reason tells Claude what to do instead — it self-corrects on the next tool call.</>,
    },
    {
      id: 'mv',
      tab: 'no-bare-mv',
      filename: 'no-bare-mv.ts',
      pack: 'clooks-core-hooks',
      kind: 'transcript',
      hookLines: mvHookLines,
      scenes: mvScenes,
      elided: <>Simplified for display.</>,
      heading: <>Rewrite the tool call<br/><span style={{ color: COL.fgMute }}>instead of blocking.</span></>,
      lead: <><code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>no-bare-mv</code> catches a plain <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>mv</code> and swaps it for <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>git mv</code> in flight. The tool call runs once with the rewritten command; the agent doesn't see a block.</>,
    },
    {
      id: 'tmux',
      tab: 'tmux-notifications',
      filename: 'tmux-notifications.ts',
      pack: 'clooks-core-hooks',
      kind: 'tmux',
      hookLines: tmuxHookLines,
      scenes: tmuxScenes,
      elided: <>Simplified for display.</>,
      heading: <>Show agent state<br/><span style={{ color: COL.fgMute }}>in your terminal.</span></>,
      lead: <><code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>tmux-notifications</code> restyles the current tmux window when Claude changes state — idle, asking for permission, or back to work. The status bar carries the signal.</>,
    },
  ];
  const demo = demos[active];

  const [expanded, setExpanded] = React.useState(!vp.isMobile);
  React.useEffect(() => { setExpanded(!vp.isMobile); }, [active, vp.isMobile]);

  return (
    <section id="demos" style={{
      padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
      borderBottom: `1px solid ${COL.line}`,
    }}
    onPointerEnter={(e) => { if (e.pointerType === 'mouse') setPaused(true); }}
    onPointerLeave={(e) => { if (e.pointerType === 'mouse') setPaused(false); }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Hook demos</SectionLabel>

        {/* Tab bar — above the heading so each demo can set its own framing */}
        <div style={{
          display: 'flex', gap: 0, marginBottom: 32,
        }}>
          {demos.map((d, i) => (
            <button key={d.id} onClick={() => setActive(i)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: vp.isMobile ? '10px 6px 12px' : '12px 20px 14px',
              fontSize: vp.isMobile ? 11 : 13,
              fontFamily: 'JetBrains Mono, monospace',
              whiteSpace: 'nowrap',
              color: active === i ? COL.fg : COL.fgMute,
              borderBottom: `2px solid ${active === i ? accent : 'transparent'}`,
              letterSpacing: 0.2,
              flex: vp.isMobile ? '1 1 0' : '0 0 auto',
              textAlign: vp.isMobile ? 'center' : 'left',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>{d.tab}</button>
          ))}
        </div>

        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 14px', maxWidth: 860,
        }}>
          {demo.heading}
        </h2>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5,
          letterSpacing: 0.6, color: COL.fgMute, marginBottom: 18,
        }}>
          from <a
            href={`https://github.com/codestripes-dev/clooks-marketplace/tree/main/${demo.pack}`}
            style={{ color: accent, textDecoration: 'none' }}
          >{demo.pack}</a>
        </div>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 40px', lineHeight: 1.65 }}>
          {demo.lead}
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: stack ? 'minmax(0, 1fr)' : 'minmax(0, 1.1fr) minmax(0, 1fr)',
          gap: stack ? 32 : 40, alignItems: 'start',
        }}>
          {/* Left: abridged hook source (collapsed by default) */}
          <div style={{
            background: COL.bgCode, border: `1px solid ${COL.line}`,
            fontFamily: 'JetBrains Mono, monospace', fontSize: vp.isMobile ? 9 : 12,
            lineHeight: 1.65, overflow: 'hidden',
            position: stack ? 'static' : (expanded ? 'sticky' : 'static'), top: 96,
          }}>
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              style={{
                all: 'unset', boxSizing: 'border-box', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '10px 14px',
                borderBottom: expanded ? `1px solid ${COL.line}` : 'none',
                fontSize: 11, color: COL.fgDim,
                fontFamily: 'JetBrains Mono, monospace',
              }}
              aria-expanded={expanded}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, background: '#4a4a4a', display: 'inline-block' }}/>
                {demo.filename}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
                <span>simplified</span>
                <span style={{ color: accent, letterSpacing: 0.5, textTransform: 'none', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {expanded ? 'hide source\u00a0▴' : 'show source\u00a0▾'}
                </span>
              </span>
            </button>
            {expanded && (
              <>
                <div style={{ display: 'flex', padding: '14px 0' }}>
                  <div style={{
                    padding: vp.isMobile ? '0 8px' : '0 12px', color: COL.fgFaint, textAlign: 'right',
                    borderRight: `1px solid ${COL.line}`, userSelect: 'none',
                    minWidth: vp.isMobile ? 28 : 36,
                  }}>
                    {demo.hookLines.map((_, i) => <div key={i}>{i + 1}</div>)}
                  </div>
                  <div style={{ padding: vp.isMobile ? '0 10px' : '0 14px', flex: 1, minWidth: 0, overflowX: vp.isMobile ? 'visible' : 'auto' }}>
                    {demo.hookLines.map((l, i) => (
                      <div key={i} style={{
                        whiteSpace: vp.isMobile ? 'pre-wrap' : 'pre',
                        overflowWrap: vp.isMobile ? 'anywhere' : 'normal',
                        minHeight: (vp.isMobile ? 9 : 12) * 1.65,
                      }}>
                        {renderLine(l)}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{
                  padding: '10px 14px', borderTop: `1px solid ${COL.line}`,
                  fontSize: 10.5, color: COL.fgDim, letterSpacing: 0.3,
                  display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                }}>
                  <span>{demo.elided}</span>
                  <span><a href="https://github.com/codestripes-dev/clooks-marketplace" style={{ color: accent, textDecoration: 'none' }}>full source →</a></span>
                </div>
              </>
            )}
          </div>

          {/* Right: scenes */}
          <div>
            {demo.scenes.map((s, i) => (
              <div key={s.id} style={{
                padding: '20px 0 28px',
                borderTop: `1px solid ${COL.line}`,
                borderBottom: i === demo.scenes.length - 1 ? `1px solid ${COL.line}` : 'none',
              }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                  letterSpacing: 0.6, color: accent, marginBottom: 8,
                }}>{s.tag}</div>
                <div style={{
                  fontSize: 17, color: COL.fg, fontWeight: 500, letterSpacing: -0.2,
                  marginBottom: 14,
                }}>{s.title}</div>

                {demo.kind === 'tmux' ? (
                  <TmuxWindowBar
                    windows={s.windows}
                    flash={s.flash}
                    paneDim={s.paneDim}
                    paneContent={s.pane}
                    accent={accent}
                  />
                ) : (
                  ccPane(s.pane)
                )}

                <div style={{
                  marginTop: 12, fontSize: 12, color: COL.fgMute,
                  fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.2,
                }}>
                  {s.note}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Scoped config (home / project / local) ----------
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
        [[TK.prop, 'js-package-manager-guard'], [TK.op, ':']],
        ['  ', [TK.prop, 'config'], [TK.op, ':']],
        ['    ', [TK.prop, 'allowed'], [TK.op, ': ['], [TK.str, '"bun"'], [TK.op, ']']],
      ],
    },
    {
      badge: 'PROJECT',
      badgeColor: accent,
      path: '.clooks/clooks.yml',
      caption: <>Committed. Overrides <span style={{ color: COL.fg, ...mono }}>HOME</span> and adds team safety hooks.</>,
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
      badgeColor: COL.yellow,
      path: '.clooks/clooks.local.yml',
      caption: <>Gitignored. Overrides <span style={{ color: COL.fg, ...mono }}>PROJECT</span>; mute hooks that bug you.</>,
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
    [[TK.prop, 'js-package-manager-guard'], [TK.op, ':']],
    ['  ', [TK.prop, 'config'], [TK.op, ':']],
    ['    ', [TK.prop, 'allowed'], [TK.op, ': ['], [TK.str, '"pnpm"'], [TK.op, ', '], [TK.str, '"npm"'], [TK.op, ']']],
    '',
    [[TK.prop, 'secret-scanner'], [TK.op, ':']],
    ['  ', [TK.prop, 'uses'], [TK.op, ': '], [TK.str, 'no-public-secrets']],
    ['  ', [TK.prop, 'enabled'], [TK.op, ': '], [TK.kw, 'false']],
  ];

  const ScopeCard = ({ layer }) => (
    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
      <CodeCard lines={layer.lines} lineNumbers={false} compact/>
      <div style={{ fontSize: 12.5, color: COL.fgMute, lineHeight: 1.5 }}>
        {layer.caption}
      </div>
    </div>
  );

  return (
    <section id="scoped-config" style={{
      padding: bp(vp, { mobile: '64px 18px', tablet: '72px 24px', desktop: '96px 32px' }),
      borderBottom: `1px solid ${COL.line}`,
    }}>
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
          The same hook — <code style={{ ...mono, color: COL.fg }}>js-package-manager-guard</code> — resolves differently
          in each repo. Clooks reads home, then project, then local; arrays replace, they don't merge.
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
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              ...mono, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase',
              color: COL.bg || '#0a0a0a', background: accent, padding: '3px 8px',
            }}>
              Resolved
            </span>
            <span style={{ fontSize: 12.5, color: COL.fgMute }}>what the hook sees</span>
          </div>
          <div style={{ width: '100%', maxWidth: 420, minWidth: 0 }}>
            <CodeCard lines={resolvedLines} lineNumbers={false} compact/>
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, {
  ProblemSection, HookInActionSection, HookAnatomySection, ConfigSection, InstallSection,
  ComparisonSection, WhyNotPluginSection, RoadmapSection, FAQSection,
  CapturesSection, TmuxHookSection, ScopedConfigSection, Footer,
});
