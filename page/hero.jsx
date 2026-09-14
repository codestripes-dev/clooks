// Hero + install block + real ClooksHook snippet

function InstallBlock({ accent, content, agent, onAgentChange, autoType = true }) {
  const vp = useViewport();
  const wrap = vp.isMobile;
  const commands = content.installSteps[agent];
  const steps = commands.map(s => ({ ...s, output: [[s.output]], typeSpeed: 12, runMs: 500 }));

  const [copied, setCopied] = React.useState(false);
  // For each step: { typed: string, phase: 'idle'|'typing'|'running'|'done' }
  const [state, setState] = React.useState([]);
  const copyTimer = React.useRef(null);
  React.useEffect(() => () => clearTimeout(copyTimer.current), []);

  const setStep = React.useCallback((i, patch) => {
    setState(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }, []);

  React.useEffect(() => {
    if (!autoType) return;
    let timer;
    setState(steps.map(() => ({ typed: '', phase: 'idle' })));
    const type = (active, length = 0) => {
      const step = steps[active];
      setStep(active, { typed: step.cmd.slice(0, length), phase: 'typing' });
      if (length < step.cmd.length) timer = setTimeout(() => type(active, length + 1), step.typeSpeed);
      else timer = setTimeout(() => {
        setStep(active, { phase: 'running' });
        timer = setTimeout(() => {
          setStep(active, { phase: 'done' });
          if (active + 1 < steps.length) timer = setTimeout(() => type(active + 1), 500);
        }, step.runMs);
      }, 300);
    };
    if (steps.length) type(0);
    return () => clearTimeout(timer);
  }, [autoType, JSON.stringify(commands), setStep]);

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
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div data-install-one-liner style={{
      background: COL.bgCode, border: `1px solid ${COL.line}`,
      fontFamily: 'JetBrains Mono, monospace', fontSize: wrap ? 9 : 13, lineHeight: 1.6,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
        padding: '10px 14px', borderBottom: `1px solid ${COL.line}`,
        fontSize: 11, color: COL.fgDim, letterSpacing: 0.3,
      }}>
        <span>~/projects/my-repo</span>
        <div role="group" aria-label="Install agent" style={{ display: 'flex', gap: 2 }}>
          {['claude', 'codex'].map(value => (
            <button key={value} type="button" aria-pressed={agent === value} onClick={() => onAgentChange(value)} style={{
              padding: '4px 8px', border: `1px solid ${agent === value ? COL.line : 'transparent'}`,
              fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
              background: agent === value ? COL.bgSoft : 'transparent', color: agent === value ? accent : COL.fgDim,
            }}>{value === 'claude' ? 'Claude' : 'Codex'}</button>
          ))}
        </div>
        <button onClick={copy} title={`Copy ${agent === 'claude' ? 'Claude' : 'Codex'} one-liner`} aria-label={`Copy ${agent === 'claude' ? 'Claude' : 'Codex'} one-liner`} style={{
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
          const s = autoType ? (state[si] || { typed: '', phase: 'idle' }) : { typed: step.cmd, phase: 'done' };
          if (s.phase === 'idle') return null;
          const showCaret = s.phase === 'typing';
          const showOutput = s.phase === 'running' || s.phase === 'done';
          const showDone = s.phase === 'done';
          return (
            <div key={si} style={{ marginTop: si === 0 ? 0 : 14 }}>
              <div style={{
                color: COL.fg,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                textIndent: wrap ? '-1.4em' : 0,
                paddingLeft: wrap ? '1.4em' : 0,
              }}>
                <span style={{ color: accent, marginRight: 10 }}>$</span>
                <ShellCommand command={s.typed}/>
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
    [[TK.kw, 'import type'], [TK.op, ' { '], [TK.ty, 'ClooksHook'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " './types'"]],
    '',
    [[TK.kw, 'export const'], [TK.fn, ' hook'], [TK.op, ': '], [TK.ty, 'ClooksHook'], [TK.op, ' = {']],
    ['  ', [TK.prop, 'meta'], [TK.op, ': {']],
    ['    ', [TK.prop, 'name'], [TK.op, ': '], [TK.str, "'no-rm-rf'"], [TK.op, ',']],
    ['    ', [TK.prop, 'description'], [TK.op, ': '], [TK.str, "'Block destructive rm commands.'"], [TK.op, ',']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'PreToolUse'], [TK.op, '('], [TK.ty, 'ctx'], [TK.op, ') {']],
    ['    ', [TK.kw, 'if'], [TK.op, ' ('], [TK.ty, 'ctx'], [TK.op, '.toolName '], [TK.op, '!== '], [TK.str, "'Bash'"], [TK.op, ') '], [TK.kw, 'return'], [TK.op, ' '], [TK.ty, 'ctx'], [TK.op, '.'], [TK.fn, 'skip'], [TK.op, '()']],
    '',
    ['    ', [TK.kw, 'const'], [TK.fn, ' cmd '], [TK.op, '= '], [TK.ty, 'ctx'], [TK.op, '.toolInput.command '], [TK.op, '?? '], [TK.str, "''"]],
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

function CursorMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         style={{ verticalAlign: '-2px' }} aria-hidden="true">
      <path d="M12 2 L22 7.5 V16.5 L12 22 L2 16.5 V7.5 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
      <path d="M12 2 V22 M2 7.5 L22 16.5 M22 7.5 L2 16.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
    </svg>
  );
}

function ClaudeMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         style={{ verticalAlign: '-2px' }} aria-hidden="true">
      <path d="M12 3 V21 M3 12 H21 M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

function WindsurfMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         style={{ verticalAlign: '-2px' }} aria-hidden="true">
      <path d="M3 17 Q8 11, 13 14 T22 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
      <path d="M3 21 Q9 16, 14 18 T22 16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.55"/>
    </svg>
  );
}

function JetBrainsMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         style={{ verticalAlign: '-2px' }} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" stroke="currentColor" strokeWidth="1.4" fill="none"/>
      <path d="M7 7 H13 M10 7 V14 Q10 16, 8 16 H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <rect x="6" y="18" width="6" height="1.2" fill="currentColor"/>
    </svg>
  );
}

function CompatRow({ accent }) {
  const vp = useViewport();
  const compact = vp.isMobile;
  const chip = {
    display: 'inline-flex', alignItems: 'center', gap: compact ? 6 : 8,
    padding: compact ? '7px 10px' : '8px 12px',
    border: `1px solid ${COL.line}`,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: compact ? 11.5 : 12.5,
    color: COL.fg, background: COL.bgCode,
    whiteSpace: 'nowrap',
    transition: 'border-color 160ms ease, color 160ms ease',
  };
  const star = { color: COL.fgDim, marginLeft: 1 };
  const iconSize = compact ? 13 : 14;
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        display: 'grid',
        gap: compact ? 6 : 8,
        gridTemplateColumns: compact || vp.isTablet
          ? 'repeat(2, minmax(0, 1fr))'
          : 'repeat(3, max-content)',
        maxWidth: compact || vp.isTablet ? 360 : 'none',
        justifyItems: 'stretch',
      }}>
        <span style={chip}><ClaudeMark size={iconSize}/> Claude Code</span>
        <span style={chip}><img src="codex.svg" alt="" width={iconSize} height={iconSize} style={{ display: 'block', flex: '0 0 auto', objectFit: 'contain', filter: 'invert(1)' }}/> Codex</span>
        <span style={chip}><CursorMark size={iconSize}/> Cursor<span style={star}>*</span></span>
        <span style={chip}><WindsurfMark size={iconSize}/> Windsurf<span style={star}>*</span></span>
        <span style={chip}><JetBrainsMark size={iconSize}/> JetBrains<span style={star}>*</span></span>
      </div>
      <div style={{ marginTop: 10, fontSize: 11.5, color: COL.fgDim, fontFamily: 'JetBrains Mono, monospace' }}>
        * via Claude Code or Codex IDE integrations
      </div>
    </div>
  );
}

function InstallOneLiner({ accent, content }) {
  const [agent, setAgent] = React.useState('claude');
  const { editing } = usePageEnvironment();
  return (
    <InstallBlock key={agent} accent={accent} content={content} agent={agent} onAgentChange={setAgent} autoType={!editing}/>
  );
}

function HeroCode({ tweaks, content }) {
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
          {content.title}<br/>
          <span style={{ color: COL.fgMute }}>{content.subtitle}</span>
        </h1>
        <p style={{
          fontSize: vp.isMobile ? 16 : 18, lineHeight: 1.55, color: COL.fgMute,
          maxWidth: 640, margin: '0 0 40px',
        }}>
          <Copy text={content.intro}/>
        </p>

        <CompatRow accent={tweaks.accent}/>

        <InstallOneLiner accent={tweaks.accent} content={content}/>

        <div style={{ maxWidth: 720, marginBottom: vp.isMobile ? 40 : 56 }}>
          <div style={{
            marginTop: vp.isMobile ? 0 : 14, fontSize: 12, color: COL.fgDim,
            fontFamily: 'JetBrains Mono, monospace',
            display: 'flex', gap: 20, flexWrap: 'wrap',
          }}>
            {content.badges.map((badge, i) => <span key={i}>{badge.text}</span>)}
          </div>
        </div>

        <div style={{ maxWidth: 900 }}>
          <div style={{
            fontSize: 11, color: COL.fgDim, marginBottom: 10,
            fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1,
            textTransform: 'uppercase',
          }}>
            {content.snippetLabel}
          </div>
          <HookSnippet/>
        </div>
      </div>
    </section>
  );
}

function HeroSplit({ tweaks, content }) {
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
            {content.title}<br/>
            <span style={{ color: COL.fgMute }}>{content.subtitle}</span>
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: COL.fgMute, margin: '0 0 32px' }}>
            <Copy text={content.intro}/>
          </p>
          <CompatRow accent={tweaks.accent}/>
          <InstallOneLiner accent={tweaks.accent} content={content}/>
          <div style={{
            marginTop: vp.isMobile ? 0 : 14, fontSize: 12, color: COL.fgDim,
            fontFamily: 'JetBrains Mono, monospace',
            display: 'flex', gap: 20, flexWrap: 'wrap',
          }}>
            {content.badges.map((badge, i) => <span key={i}>{badge.text}</span>)}
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
