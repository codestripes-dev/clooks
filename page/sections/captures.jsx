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
      title: 'A hook refuses a destructive\u00a0command.',
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
        { label: 'Clooks output', color: accent, note: 'reason string from the hook appears as the blocking\u00a0error' },
        { label: 'Claude\'s reply', color: COL.green, note: 'reads the reason and relays it back to the user\u00a0unprompted' },
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
        [['a', '● '], ['f', 'The "crashy-linter" hook crashed with a TypeError and blocked the tool call.']],
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
        [['a', '● '], ['f', 'The hook '], ['mono', 'broken-dev-hook'], ['f', ' errored with a SyntaxError, but it was configured as '], ['mono', 'onError: trace'], ['f', ', so it did not block the action. The command '], ['mono', 'debug-me'], ['f', ' executed successfully.']],
      ],
      annotations: [
        { label: 'Failure as context', color: accent, note: 'hook failures surface in the agent loop, formatted for the model' },
        { label: 'Context injection', color: COL.green, note: 'the error becomes context the agent can reason about' },
      ],
    },
  ];

  const cap = captures[active];

  return (
    <section id="captures" className="section section--elev">
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

Object.assign(window, { CapturesSection, TerminalTranscript });
