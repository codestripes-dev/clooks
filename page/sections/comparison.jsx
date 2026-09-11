function ComparisonSection({ accent }) {
  const rows = [
    ['Failure mode',           'Provider- and event-defined behavior',        'Configurable error policy; refusal depends on the native event'],
    ['Language',               'Provider-defined handler contracts',          'TypeScript with typed event contracts'],
    ['Composition',            'Provider-defined execution and ordering',     'Parallel or sequential with explicit order'],
    ['Input modification',     'Provider- and tool-specific rewrites',         'Sequential pipeline; validated updates reach later hooks'],
    ['Retries',                'Per invocation only',                         'Circuit breaker auto-disables after N failures'],
    ['Distribution',           'Provider-specific packaging and settings',    'Vendor GitHub hook files or root-manifest packs'],
    ['Portability',            'Lives in your settings',                      'Vendored into .clooks/, committed'],
  ];
  const vp = useViewport();
  const stack = vp.isMobile;
  return (
    <section className="section">
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
        <div id="support" style={{ marginTop: 36, fontSize: 14, lineHeight: 1.65, color: COL.fgMute }}>
          <h3 style={{ fontSize: 20, color: COL.fg, margin: '0 0 12px' }}>Claude Code + Codex support</h3>
          <p>Claude Code retains its existing event and decision behavior. Codex supports eleven events: SessionStart, SubagentStart, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStop, Stop, and SessionEnd. Interrupt is not supported.</p>
          <p>Shared configuration and ordering, provider-specific decisions and tool inputs. Codex exec_command maps to Bash, but apply_patch is not Claude Edit/Write. Claude keeps native ctx.ask; Codex PreToolUse handler ask uses a Clooks denial/token fallback, not a native approval prompt. Native trust, approvals, and sandbox policy still apply.</p>
          <p>Codex startup and post-compaction/session-end handlers are observers. SessionEnd cannot veto closure, and post-tool feedback cannot undo side effects. Event support is not universal enforcement or full parity. See the <a href="https://github.com/codestripes-dev/clooks#readme">README</a> and <a href="https://github.com/codestripes-dev/clooks/blob/master/docs/domain/cross-agent-hooks.md">capability details</a> for exact limits.</p>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { ComparisonSection });
