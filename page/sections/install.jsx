function InstallSection({ accent, tweaks }) {
  const vp = useViewport();
  const stack = vp.isMobile;
  const [path, setPath] = React.useState(() => {
    const route = window.location.hash.replace('#install-', '');
    return ['claude', 'codex', 'binary'].includes(route) ? route : 'codex';
  });
  React.useEffect(() => {
    const selectRoute = () => {
      const route = window.location.hash.replace('#install-', '');
      if (['claude', 'codex', 'binary'].includes(route)) setPath(route);
    };
    window.addEventListener('hashchange', selectRoute);
    return () => window.removeEventListener('hashchange', selectRoute);
  }, []);

  const paths = {
    claude: {
      label: 'Claude plugin',
      blurb: 'Add the plugin from your terminal, then run setup inside Claude Code to install Clooks and configure your project.',
      steps: [
        { t: 'Add the marketplace',
          cmd: 'claude plugin marketplace add codestripes-dev/clooks-marketplace',
          d: 'Adds the Clooks marketplace to Claude Code.' },
        { t: 'Install the clooks plugin',
          cmd: 'claude plugin install clooks@clooks-marketplace',
          d: 'Adds the setup skill and a reminder if Clooks needs setup. Reload Claude Code if the skill is not available yet.' },
        { t: 'In Claude Code: run setup',
          cmd: '/clooks:setup',
          d: 'Reuses or installs Clooks, then configures hooks for Claude Code in your project. Setup also offers user-wide hooks.',
          slash: true },
        { t: 'Optional — install a hook pack',
          cmd: 'claude plugin install clooks-core-hooks@clooks-marketplace --scope user',
          d: 'Adds ready-made hooks, including no-rm-rf, to your Claude Code setup.' },
      ],
    },
    codex: {
      label: 'Codex plugin',
      blurb: 'Add the plugin from your terminal, then run setup inside Codex to install Clooks and configure your project.',
      steps: [
        { t: 'Add the marketplace',
          cmd: 'codex plugin marketplace add codestripes-dev/clooks-marketplace',
          d: 'Adds the Clooks marketplace to Codex.' },
        { t: 'Install the Clooks plugin',
          cmd: 'codex plugin add clooks@clooks-marketplace',
          d: 'Adds $clooks:setup and a startup reminder. Review the plugin hooks when Codex prompts you.' },
        { t: 'In Codex: run setup',
          cmd: '$clooks:setup',
          slash: true,
          d: 'Send this as a Codex message, not a shell command. Setup reuses or installs Clooks and configures your project. Review the generated hooks when prompted. You can also ask setup to configure both agents or user-wide hooks.' },
        { t: 'Optional: add a hook from your terminal',
          cmd: 'clooks add https://github.com/codestripes-dev/clooks-marketplace/blob/master/clooks-core-hooks/hooks/no-rm-rf.ts',
          d: 'Downloads and registers one hook. The Codex plugin does not install hook packs for you. Review hook code before running it.' },
      ],
    },
    binary: {
      label: 'Direct binary',
      blurb: 'No plugin required. Download Clooks, then configure your project for Codex, Claude Code, or both. Review hooks when your agent prompts you.',
      steps: [
        { t: 'Download the binary',
          cmd: 'chmod +x clooks-linux-x64\nmkdir -p "$HOME/.local/bin"\ncp clooks-linux-x64 "$HOME/.local/bin/clooks"\nexport PATH="$HOME/.local/bin:$PATH"\nclooks --version',
          d: <>Download from <a href="https://github.com/codestripes-dev/clooks/releases/latest">GitHub releases</a> first. These commands use the linux-x64 asset in your current directory; substitute clooks-darwin-arm64, clooks-darwin-x64, clooks-linux-x64-baseline, or clooks-linux-arm64 for your platform. Keep ~/.local/bin on PATH in your shell profile.</> },
        { t: 'Initialize Codex in your repo',
          cmd: 'clooks init --agent codex',
          d: 'Writes shared .clooks/ files and registers eleven events in .codex/hooks.json. Native project trust and hook review still apply. Re-run init to refresh an existing installation, including SessionEnd registration.' },
        { t: 'Or register both agents',
          cmd: 'clooks init --agent all',
          d: 'Registers Claude Code in .claude/settings.json and Codex in .codex/hooks.json using the same .clooks/clooks.yml. Plain clooks init (or --agent claude-code) registers only Claude Code.' },
        { t: 'Install a hook',
          cmd: 'clooks add https://github.com/codestripes-dev/clooks-marketplace/blob/master/clooks-core-hooks/hooks/no-rm-rf.ts',
          d: 'Downloads and registers this single TypeScript hook. Repository pack installs require clooks-pack.json at the repository root; a marketplace tree/pack URL does not select a nested pack. Review hook code before running it.' },
        { t: 'Share the project setup',
          cmd: 'git add .clooks .codex/hooks.json',
          d: 'Review and commit the configuration and vendored hooks. For both agents, include .claude/settings.json too. Codex registrations contain absolute checkout paths: each teammate must re-run init in their own checkout.' },
      ],
    },
  };

  const active = paths[path];

  return (
    <section id="install" className="section section--elev">
      <span id="install-claude"/><span id="install-codex"/><span id="install-binary"/>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Install</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 780,
        }}>
          Three ways to install.
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 28px', lineHeight: 1.6 }}>
          Choose your setup path. Plugins add the setup command; Clooks is installed when you run it.
        </p>

        <div style={{
          display: 'flex', gap: 0, marginBottom: 0,
          borderBottom: `1px solid ${COL.line}`,
        }}>
          {Object.entries(paths).map(([key, p]) => (
            <button key={key} onClick={() => {
              setPath(key);
              window.history.replaceState(null, '', `#install-${key}`);
            }} aria-pressed={path === key} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: vp.isMobile ? '10px 8px 12px' : '12px 20px 14px',
              fontSize: vp.isMobile ? 12 : 13, fontFamily: 'inherit',
              whiteSpace: 'normal',
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
            <div key={`${path}-${i}`} style={{
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
                    <CmdBox accent={accent} cmd={s.cmd} slash={s.slash} comment={s.comment} copyLabel={`Copy ${active.label}: ${s.t}`}/>
                  </div>
                )}
              </div>
              {!stack && !vp.isTablet && (
                <div style={{ alignSelf: 'center', minWidth: 0 }}>
                  <CmdBox accent={accent} cmd={s.cmd} slash={s.slash} comment={s.comment} copyLabel={`Copy ${active.label}: ${s.t}`}/>
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
            <p style={{ margin: '0 0 12px' }}>Already have Clooks? Setup reuses it. To update, run the setup command with update, or use your original installation method.</p>
            <p style={{ margin: '0 0 12px' }}>Your agent must be able to find clooks on PATH. After adding it, relaunch the agent if needed. Approve hooks when your agent prompts you.</p>
            <p style={{ margin: '0 0 12px' }}>After cloning, moving, or creating a worktree, re-run init for your agent before using Codex hooks: project registrations contain absolute paths.</p>
            For user-wide hooks, run <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>clooks init --global --agent codex</code>. Use --agent all for both agents. Shared hooks live in ~/.clooks/; Codex settings go under CODEX_HOME (default ~/.codex).
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { InstallSection });
