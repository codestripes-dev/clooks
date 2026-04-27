// Hero + install block + real ClooksHook snippet

function InstallBlock({ cmd, accent, autoType = true, lines = [] }) {
  const vp = useViewport();
  const wrap = vp.isMobile;
  // Three-step install: add marketplace → install+enable plugin → scaffold
  const steps = [
    {
      cmd,
      output: [
        ['→ Added marketplace ', ['muted', 'codestripes-dev/clooks-marketplace']],
      ],
      doneLabel: '✓ added.',
      typeSpeed: 12,
      runMs: 500,
    },
    {
      cmd: 'claude plugin install clooks@clooks-marketplace',
      output: [
        ['→ Installed ', ['muted', `clooks@${window.CLOOKS_VERSION}`], ', enabled in this project.'],
      ],
      doneLabel: '✓ enabled.',
      typeSpeed: 12,
      runMs: 500,
    },
    {
      cmd: 'claude /clooks:setup',
      output: [
        ['→ Created ', ['code', '.clooks/clooks.yml'], ', ', ['code', '.clooks/hooks/'], ', ', ['code', '.clooks/vendor/']],
        ['→ Installed ', ['muted', `clooks-core-hooks@${window.CLOOKS_VERSION}`], ' (3 hooks)'],
      ],
      doneLabel: '✓ ready.',
      typeSpeed: 14,
      runMs: 600,
    },
  ];

  const [copied, setCopied] = React.useState(false);
  // For each step: { typed: string, phase: 'idle'|'typing'|'running'|'done' }
  const [state, setState] = React.useState(
    steps.map((s, i) => ({ typed: autoType ? '' : s.cmd, phase: autoType ? (i === 0 ? 'typing' : 'idle') : 'done' }))
  );

  const setStep = React.useCallback((i, patch) => {
    setState(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }, []);

  // Drive each step's typing + running
  React.useEffect(() => {
    if (!autoType) return;
    const active = state.findIndex(s => s.phase === 'typing');
    if (active === -1) return;
    const { cmd: c, typeSpeed, runMs } = steps[active];
    let i = state[active].typed.length;
    const iv = setInterval(() => {
      i++;
      setStep(active, { typed: c.slice(0, i) });
      if (i >= c.length) {
        clearInterval(iv);
        setTimeout(() => setStep(active, { phase: 'running' }), 300);
        setTimeout(() => {
          setStep(active, { phase: 'done' });
          if (active + 1 < steps.length) {
            setTimeout(() => setStep(active + 1, { phase: 'typing' }), 500);
          }
        }, 300 + runMs);
      }
    }, typeSpeed);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.map(s => s.phase).join(',')]);

  const copy = async () => {
    const parts = steps.map(s => s.cmd);
    const text = parts.join(' && ');
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {}
    if (!ok) {
      // Fallback for sandboxed iframes where clipboard API is blocked
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
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
      fontFamily: 'JetBrains Mono, monospace', fontSize: wrap ? 9 : 13, lineHeight: 1.6,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${COL.line}`,
        fontSize: 11, color: COL.fgDim, letterSpacing: 0.3,
      }}>
        <span>~/projects/my-repo</span>
        <button onClick={copy} style={{
          background: copied ? accent : 'transparent',
          border: `1px solid ${copied ? accent : COL.line}`,
          color: copied ? COL.bg : COL.fgMute,
          cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
          fontWeight: copied ? 600 : 400,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px',
          transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
        }}>
          {copied ? (
            <><svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M2 6.5 L5 9.5 L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"/>
            </svg>Copied!</>
          ) : (
            <><svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <rect x="3.5" y="3.5" width="6" height="6" stroke="currentColor" strokeWidth="1" fill="none"/>
              <path d="M2 2 H8 V3" stroke="currentColor" strokeWidth="1" fill="none"/>
            </svg>copy one-liner</>
          )}
        </button>
      </div>
      <div style={{ padding: '16px 18px', overflowX: wrap ? 'visible' : 'auto' }}>
        {steps.map((step, si) => {
          const s = state[si];
          if (s.phase === 'idle') return null;
          const showCaret = s.phase === 'typing';
          const showOutput = s.phase === 'running' || s.phase === 'done';
          const showDone = s.phase === 'done';
          return (
            <div key={si} style={{ marginTop: si === 0 ? 0 : 14 }}>
              <div style={{
                color: COL.fg,
                whiteSpace: wrap ? 'pre-wrap' : 'pre',
                overflowWrap: wrap ? 'anywhere' : 'normal',
                textIndent: wrap ? '-1.4em' : 0,
                paddingLeft: wrap ? '1.4em' : 0,
              }}>
                <span style={{ color: accent, marginRight: 10 }}>$</span>
                <span>{s.typed}</span>
                {showCaret && (
                  <span style={{
                    display: 'inline-block', width: 7, height: 15,
                    background: COL.fg, marginLeft: 2, verticalAlign: '-2px',
                    animation: 'blink 1s steps(1) infinite',
                  }}/>
                )}
              </div>
              {showOutput && (
                <div style={{ marginTop: 10, color: COL.fgMute, fontSize: 12.5 }}>
                  {step.output.map((line, i) => (
                    <div key={i}>
                      {line.map((seg, j) => {
                        if (typeof seg === 'string') return <span key={j}>{seg}</span>;
                        const [kind, val] = seg;
                        if (kind === 'muted') return <span key={j} style={{ color: COL.fgDim }}>{val}</span>;
                        if (kind === 'code') return <span key={j} style={{ color: COL.fg }}>{val}</span>;
                        return <span key={j}>{val}</span>;
                      })}
                    </div>
                  ))}
                  {showDone && (
                    <div style={{ color: COL.green, marginTop: 4 }}>
                      {step.doneLabel}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HookSnippet({ compact = false }) {
  // Real ClooksHook object shape (not definePreToolUse)
  const lines = [
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

  return (
    <CodeCard
      title="no-rm-rf.ts"
      badge="typescript"
      badgeColor={COL.fgDim}
      lines={lines}
      compact={compact}
    />
  );
}

function HookOutcome({ accent }) {
  return (
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
          <span style={{ color: COL.red }}>blocked</span>
        </div>
      </div>
      <div style={{ padding: '14px 16px' }}>
        <div>
          <span style={{ color: accent, marginRight: 8 }}>❯</span>
          <span>clean up stale build artifacts</span>
        </div>
        <div style={{ height: 6 }}/>
        <div>
          <span style={{ color: accent, marginRight: 8 }}>●</span>
          <span>I'll remove them now.</span>
        </div>
        <div style={{ color: COL.fgDim, paddingLeft: 16 }}>
          Bash · <span style={{ color: COL.fgMute }}>rm -rf /tmp/build ~</span>
        </div>
        <div style={{ color: COL.red, paddingLeft: 16 }}>
          {'  ⎿  '}PreToolUse:Bash hook returned blocking error
        </div>
        <div style={{ color: COL.fg, paddingLeft: 24 }}>
          refusing: rm -rf /tmp/build ~
        </div>
        <div style={{ height: 6 }}/>
        <div>
          <span style={{ color: accent, marginRight: 8 }}>●</span>
          <span>The <span style={{ color: COL.fgMute }}>no-rm-rf</span> hook blocked that — the trailing <span style={{ color: COL.fgMute }}>~</span> would have wiped your home. Run just <span style={{ color: COL.fgMute }}>/tmp/build</span> instead?</span>
        </div>
      </div>
    </div>
  );
}

function HeroCode({ tweaks }) {
  const vp = useViewport();
  return (
    <section style={{
      padding: bp(vp, { mobile: '56px 18px 48px', tablet: '72px 24px 60px', desktop: '96px 32px 80px' }),
      borderBottom: `1px solid ${COL.line}`,
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: 2,
          textTransform: 'uppercase', color: tweaks.accent, marginBottom: 22,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ width: 24, height: 1, background: tweaks.accent, display: 'inline-block' }}/>
          v{window.CLOOKS_VERSION}
        </div>
        <h1 style={{
          fontSize: bp(vp, { mobile: 40, tablet: 56, desktop: 'clamp(44px, 6vw, 76px)' }),
          lineHeight: 1.02,
          letterSpacing: vp.isMobile ? -1 : -2,
          fontWeight: 500, margin: '0 0 24px', maxWidth: 980,
        }}>
          TypeScript hooks<br/>
          <span style={{ color: COL.fgMute }}>for Claude Code.</span>
        </h1>
        <p style={{
          fontSize: vp.isMobile ? 16 : 18, lineHeight: 1.55, color: COL.fgMute,
          maxWidth: 640, margin: '0 0 40px',
        }}>
          Write hooks as small TypeScript files. Clooks runs them when Claude Code
          edits files, runs commands, or finishes a session — and blocks the
          action if a hook{'\u00a0'}crashes.
        </p>

        <div style={{ maxWidth: 720, marginBottom: vp.isMobile ? 40 : 56 }}>
          <InstallBlock cmd={tweaks.installCmd} accent={tweaks.accent}/>
          <div style={{
            marginTop: 14, fontSize: 12, color: COL.fgDim,
            fontFamily: 'JetBrains Mono, monospace',
            display: 'flex', gap: 20, flexWrap: 'wrap',
          }}>
            <span>macOS · Linux</span>
            <span>Compiled Bun binary</span>
            <span>MIT license</span>
          </div>
        </div>

        <div style={{ maxWidth: 900 }}>
          <div style={{
            fontSize: 11, color: COL.fgDim, marginBottom: 10,
            fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1,
            textTransform: 'uppercase',
          }}>
            A real hook:
          </div>
          <HookSnippet/>
        </div>
      </div>
    </section>
  );
}

function HeroSplit({ tweaks }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;
  return (
    <section style={{
      padding: bp(vp, { mobile: '56px 18px 48px', tablet: '72px 24px 60px', desktop: '96px 32px 80px' }),
      borderBottom: `1px solid ${COL.line}`,
    }}>
      <div style={{
        maxWidth: 1200, margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: stack ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1.1fr)',
        gap: stack ? 40 : 56, alignItems: 'start',
      }}>
        <div>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: 2,
            textTransform: 'uppercase', color: tweaks.accent, marginBottom: 22,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ width: 24, height: 1, background: tweaks.accent, display: 'inline-block' }}/>
            v{window.CLOOKS_VERSION}
          </div>
          <h1 style={{
            fontSize: bp(vp, { mobile: 38, tablet: 52, desktop: 'clamp(40px, 4.4vw, 60px)' }),
            lineHeight: 1.05,
            letterSpacing: vp.isMobile ? -1 : -1.6,
            fontWeight: 500, margin: '0 0 22px',
          }}>
            TypeScript hooks<br/>
            <span style={{ color: COL.fgMute }}>for Claude Code.</span>
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: COL.fgMute, margin: '0 0 32px' }}>
            Write hooks as small TypeScript files. Clooks runs them when Claude Code
            edits files or runs commands, and blocks the action if a hook{'\u00a0'}crashes.
          </p>
          <InstallBlock cmd={tweaks.installCmd} accent={tweaks.accent}/>
          <div style={{
            marginTop: 14, fontSize: 12, color: COL.fgDim,
            fontFamily: 'JetBrains Mono, monospace',
            display: 'flex', gap: 20, flexWrap: 'wrap',
          }}>
            <span>macOS · Linux</span>
            <span>Compiled Bun binary</span>
            <span>MIT license</span>
          </div>
        </div>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <HookSnippet/>
          <HookOutcome accent={tweaks.accent}/>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { InstallBlock, HookSnippet, HookOutcome, HeroCode, HeroSplit });
