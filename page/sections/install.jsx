function InstallSection({ accent, tweaks }) {
  const vp = useViewport();
  const stack = vp.isMobile;
  const [path, setPath] = React.useState('plugin');
  const [copiedOneLiner, setCopiedOneLiner] = React.useState(false);

  const oneLiner = 'claude plugin marketplace add codestripes-dev/clooks-marketplace && claude plugin install clooks@clooks-marketplace && claude /clooks:setup';

  const copyOneLiner = async () => {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(oneLiner);
        ok = true;
      }
    } catch {}
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = oneLiner;
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
      setCopiedOneLiner(true);
      setTimeout(() => setCopiedOneLiner(false), 1800);
    }
  };

  const paths = {
    plugin: {
      label: 'Plugin (fastest)',
      blurb: 'Install through the Claude Code plugin system. The plugin is a bootstrap — it registers a SessionStart hook that tells Claude to run /clooks:setup, which downloads the binary and runs clooks init in your\u00a0project.',
      steps: [
        { t: 'Add the marketplace',
          cmd: 'claude plugin marketplace add codestripes-dev/clooks-marketplace',
          d: 'A separate repo that hosts plugin metadata and points at source.' },
        { t: 'Install the clooks plugin',
          cmd: 'claude plugin install clooks@clooks-marketplace',
          d: 'Bootstrap only. Drops a SessionStart hook and the /clooks:setup skill. Does not put the runtime on PATH — reload Claude Code to\u00a0activate.' },
        { t: 'Run /clooks:setup',
          cmd: '/clooks:setup',
          d: 'Runs inside Claude Code. Downloads the latest release binary for your platform, places it on PATH, and runs clooks init in the current\u00a0project.',
          slash: true },
        { t: 'Optional — install a hook pack',
          cmd: 'claude plugin install clooks-core-hooks --scope user',
          d: 'Six ready-made safety and quality hooks, including no-rm-rf. Use --scope user to apply them everywhere on this machine; use --scope project to commit the plugin entry to this repo so teammates get it\u00a0too.' },
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
    <section id="install" className="section section--elev">
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Install</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 780,
        }}>
          Three ways to install.
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 28px', lineHeight: 1.6 }}>
          Each path ends the same way — a committed <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg, whiteSpace: 'nowrap' }}>.clooks/</code> folder and the binary on your{'\u00a0'}PATH.
        </p>

        <div style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
          color: accent, marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ width: 18, height: 1, background: accent, display: 'inline-block' }}/>
          One-liner
        </div>
        <div style={{
          marginBottom: 36,
          border: `1px solid ${COL.line}`,
          background: COL.bgCode,
          display: 'flex', alignItems: 'stretch',
        }}>
          <div style={{
            padding: stack ? '12px 14px' : '14px 18px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: stack ? 10.5 : 12.5,
            color: COL.fg,
            flex: 1, minWidth: 0,
            overflowX: 'auto',
            whiteSpace: 'nowrap',
          }}>
            <span style={{ color: accent, marginRight: 10 }}>$</span>
            {oneLiner}
          </div>
          <button onClick={copyOneLiner} title={copiedOneLiner ? 'Copied' : 'Copy'} style={{
            flex: '0 0 auto',
            background: copiedOneLiner ? accent : 'transparent',
            border: 'none', borderLeft: `1px solid ${COL.line}`,
            color: copiedOneLiner ? COL.bg : COL.fgMute,
            cursor: 'pointer',
            padding: stack ? '12px 14px' : '14px 18px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11, letterSpacing: 0.3,
            fontWeight: copiedOneLiner ? 600 : 400,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            whiteSpace: 'nowrap',
            transition: 'background 120ms ease, color 120ms ease',
          }}>
            {copiedOneLiner ? (
              <><svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6.5 L5 9.5 L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="square" fill="none"/>
              </svg>Copied!</>
            ) : (
              <><svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="3.5" y="3.5" width="6" height="6" stroke="currentColor" strokeWidth="1" fill="none"/>
                <path d="M2 2 H8 V3" stroke="currentColor" strokeWidth="1" fill="none"/>
              </svg>Copy</>
            )}
          </button>
        </div>

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
                <div style={{ alignSelf: 'center' }}>
                  <CmdBox accent={accent} cmd={s.cmd} slash={s.slash} comment={s.comment}/>
                </div>
              )}
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${COL.line}` }}/>
        </div>

        <div style={{
          marginTop: 40, padding: '20px 24px',
          background: COL.bgSoft, border: `1px solid ${COL.line}`,
          display: 'grid',
          gridTemplateColumns: stack ? '1fr' : 'auto 1fr',
          gap: stack ? 10 : 20, alignItems: 'start',
        }}>
          <span style={{
            color: accent, fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', paddingTop: 2,
            whiteSpace: 'nowrap',
          }}>Heads up</span>
          <div style={{ fontSize: 14, color: COL.fgMute, lineHeight: 1.65 }}>
            Global mode: add <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>clooks init --global</code> to register hooks under <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>~/.clooks/</code> for every Claude Code session.
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { InstallSection });
