// Hero + install block + real ClooksHook snippet

function InstallBlock({ cmd, accent, autoType = true, lines = [] }) {
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
        ['→ Installed ', ['muted', 'clooks@1.2.0'], ', enabled in this project.'],
      ],
      doneLabel: '✓ enabled.',
      typeSpeed: 12,
      runMs: 500,
    },
    {
      cmd: '/clooks:setup',
      output: [
        ['→ Created ', ['code', '.clooks/clooks.yml'], ', ', ['code', '.clooks/hooks/'], ', ', ['code', '.clooks/lockfile.json']],
        ['→ Installed ', ['muted', 'clooks-core-hooks@1.2.0'], ' (3 hooks)'],
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
    const parts = steps.map((s, i) => i === steps.length - 1 ? `claude ${s.cmd}` : s.cmd);
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
      fontFamily: 'JetBrains Mono, monospace', fontSize: 13, lineHeight: 1.6,
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
      <div style={{ padding: '16px 18px', overflowX: 'auto' }}>
        {steps.map((step, si) => {
          const s = state[si];
          if (s.phase === 'idle') return null;
          const showCaret = s.phase === 'typing';
          const showOutput = s.phase === 'running' || s.phase === 'done';
          const showDone = s.phase === 'done';
          return (
            <div key={si} style={{ marginTop: si === 0 ? 0 : 14 }}>
              <div style={{ color: COL.fg, whiteSpace: 'pre' }}>
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

function HeroCode({ tweaks }) {
  return (
    <section style={{ padding: '96px 32px 80px', borderBottom: `1px solid ${COL.line}` }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: 2,
          textTransform: 'uppercase', color: tweaks.accent, marginBottom: 22,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ width: 24, height: 1, background: tweaks.accent, display: 'inline-block' }}/>
          v0.0.1 · pre-release · Claude Code
        </div>
        <h1 style={{
          fontSize: 'clamp(44px, 6vw, 76px)', lineHeight: 1.02,
          letterSpacing: -2, fontWeight: 500, margin: '0 0 24px', maxWidth: 980,
        }}>
          A TypeScript hook runtime<br/>
          <span style={{ color: COL.fgMute }}>for Claude Code.</span>
        </h1>
        <p style={{
          fontSize: 18, lineHeight: 1.55, color: COL.fgMute,
          maxWidth: 640, margin: '0 0 40px',
        }}>
          Write hooks once, run them safely, share them across projects and teams.
          Clooks wraps Claude Code's native hooks — so a crashed hook blocks the action
          instead of silently passing through.
        </p>

        <div style={{ maxWidth: 720, marginBottom: 56 }}>
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
            A hook, start to finish:
          </div>
          <HookSnippet/>
        </div>
      </div>
    </section>
  );
}

function HeroSplit({ tweaks }) {
  return (
    <section style={{ padding: '96px 32px 80px', borderBottom: `1px solid ${COL.line}` }}>
      <div style={{
        maxWidth: 1200, margin: '0 auto',
        display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 56, alignItems: 'start',
      }}>
        <div>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: 2,
            textTransform: 'uppercase', color: tweaks.accent, marginBottom: 22,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ width: 24, height: 1, background: tweaks.accent, display: 'inline-block' }}/>
            v0.0.1 · pre-release
          </div>
          <h1 style={{
            fontSize: 'clamp(40px, 4.4vw, 60px)', lineHeight: 1.05,
            letterSpacing: -1.6, fontWeight: 500, margin: '0 0 22px',
          }}>
            TypeScript hooks<br/>
            <span style={{ color: COL.fgMute }}>for Claude Code.</span>
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: COL.fgMute, margin: '0 0 32px' }}>
            Write hooks once, run them safely, share them across projects and teams.
            Clooks wraps native hooks so a crash blocks — it doesn't pass through.
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
        <div style={{ position: 'relative' }}>
          <HookSnippet/>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { InstallBlock, HookSnippet, HeroCode, HeroSplit });
