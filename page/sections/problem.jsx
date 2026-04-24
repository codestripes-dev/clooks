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
      d: 'Native hooks are bash strings inside .claude/settings.json. Every hook is a one-liner you quote by\u00a0hand or write a new bash script for.' },
    { n: '03', k: 'No composition',
      d: 'All native hooks run in parallel. No ordering, no pipeline, no way for one hook to modify input before another sees it.' },
    { n: '04', k: 'Tricky portability',
      d: 'A hook you wrote for one repo lives in that repo\'s settings file. Copying it to the next project means re-pasting bash strings and re-committing script files. And in plugins, you might not want every hook enabled.'  },
    { n: '05', k: 'No discoverability',
      d: 'The best hooks are gists linked in Discord threads. Sharing only works through Claude Marketplace, which can open up update injection vectors.' },
  ];

  return (
    <section id="problem" className="section">
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
              a crashed hook blocks the action by{'\u00a0'}default.
            </p>

            <div style={{
              border: `1px solid ${COL.line}`, background: COL.bgSoft,
              padding: '22px 26px',
              display: 'grid', gridTemplateColumns: '20px 1fr', gap: 18,
            }}>
              <div style={{ width: 2, background: COL.red, alignSelf: 'stretch' }}/>
              <div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COL.fgDim, marginBottom: 8 }}>
                  claude-code docs — Hooks reference
                </div>
                <div style={{ fontSize: 14.5, color: COL.fg, lineHeight: 1.55 }}>
                  "For most hook events, only exit code 2 blocks the action.
                  Claude Code treats exit code 1 as a non-blocking error and proceeds
                  with the action, even though 1 is the conventional Unix failure code."
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

Object.assign(window, { ProblemSection });
