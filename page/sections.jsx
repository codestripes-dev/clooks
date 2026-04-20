// Body sections: problem, hook anatomy, config, install flow, comparison,
// why-not-plugin, roadmap, faq, footer

// ---------- Copyable command box (used in Install tabs) ----------
function CmdBox({ accent, cmd, slash, comment }) {
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
      fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5,
      color: COL.fg, alignSelf: 'start', position: 'relative',
      display: 'flex', alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1, padding: '14px 16px', overflowX: 'auto', whiteSpace: 'pre', minWidth: 0 }}>
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

// ---------- Problem: rm -rf story + pain list ----------
function ProblemSection({ accent }) {
  const pains = [
    { n: '01', k: 'Silent failures',
      d: 'Claude Code only blocks on exit code 2. A guard hook that crashes — a typo, a missing dep — doesn\'t prevent the action. The dangerous op proceeds as if the hook were never there.' },
    { n: '02', k: 'Bash inside JSON',
      d: 'Native hooks are strings in .claude/settings.json. No schema, no types, no imports. You escape quotes until your jq pipeline works, then you pray.' },
    { n: '03', k: 'No composition',
      d: 'All native hooks run in parallel. No ordering, no pipeline, no way for one hook to modify input before another sees it. (Open issue claude-code#15897.)' },
    { n: '04', k: 'No portability',
      d: 'A hook that works on your machine lives in your settings. A teammate clones the repo and gets nothing — or a different version.' },
    { n: '05', k: 'No discoverability',
      d: 'The best hooks are gists linked in Discord threads. There is no registry, no pinning, no lockfile.' },
  ];

  return (
    <section id="problem" style={{ padding: '96px 32px', borderBottom: `1px solid ${COL.line}` }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>The gap</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 820,
        }}>
          The hook that was supposed<br/>to stop <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85em', color: COL.red, background: 'rgba(248,113,113,0.08)', padding: '2px 8px' }}>rm -rf ~/</code> crashed.
        </h2>
        <p style={{ fontSize: 17, color: COL.fgMute, maxWidth: 680, margin: '0 0 40px', lineHeight: 1.55 }}>
          Somebody's agent ran <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>rm -rf tests/ patches/ plan/ ~/</code>.
          The trailing <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>~/</code> wiped the Mac.
          There was a guard hook for exactly this. It threw an exception, exited non-zero-but-not-2, and Claude ran the command anyway.
          Native hooks pass through on anything that isn't a clean exit 2 — fail-open by default. That's the first thing Clooks changes.
        </p>

        {/* Quote-style incident card */}
        <div style={{
          border: `1px solid ${COL.line}`, background: COL.bgSoft,
          padding: '24px 28px', margin: '0 0 64px',
          display: 'grid', gridTemplateColumns: '20px 1fr', gap: 18,
          maxWidth: 820,
        }}>
          <div style={{ width: 2, background: COL.red, alignSelf: 'stretch' }}/>
          <div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: COL.fgDim, marginBottom: 8 }}>
              claude-code · issue #15897
            </div>
            <div style={{ fontSize: 15, color: COL.fg, lineHeight: 1.55 }}>
              "All hooks run in parallel. There is no ordering guarantee, no way to
              chain modifications, no way to know which one blocked."
            </div>
          </div>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          borderTop: `1px solid ${COL.line}`,
        }}>
          {pains.map((p, i) => {
            const row = Math.floor(i / 3);
            const col = i % 3;
            const totalRows = Math.ceil(pains.length / 3);
            return (
              <div key={p.n} style={{
                padding: '28px 28px 28px 0',
                borderRight: col !== 2 ? `1px solid ${COL.line}` : 'none',
                borderBottom: row < totalRows - 1 ? `1px solid ${COL.line}` : 'none',
                paddingLeft: col === 0 ? 0 : 28,
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
  const items = [
    { n: '01', k: 'meta',
      d: 'A name and optional description. Nothing else — no version, author, or permissions fields.' },
    { n: '02', k: 'Event methods',
      d: 'One method per event. Subscribing is as simple as defining the method. 22 events available.' },
    { n: '03', k: 'Typed ctx, tagged result',
      d: 'ctx is narrowed per event. Return { result: "allow" | "block" | "skip" } — or "ask" | "defer" on PreToolUse. Unknown values are treated as failures.' },
  ];

  return (
    <section id="hook" style={{
      padding: '96px 32px', borderBottom: `1px solid ${COL.line}`, background: COL.bgElev,
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Hook API</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 780,
        }}>
          Typed hooks as code.<br/>
          <span style={{ color: COL.fgMute }}>One object, or many per file.</span>
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 56px', lineHeight: 1.6 }}>
          Export one or more <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>ClooksHook</code> objects per file — group them by concern or split one-per-file, your call.
          Each event is a method with a typed context and a tagged-result return. Config is validated with Zod, merged shallowly over your defaults.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'start' }}>
          <div style={{ position: 'sticky', top: 100 }}>
            <HookSnippet compact/>
          </div>
          <div>
            {items.map(item => (
              <div key={item.n} style={{
                padding: '20px 0', borderBottom: `1px solid ${COL.line}`,
                display: 'grid', gridTemplateColumns: '44px 1fr', gap: 20,
              }}>
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
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}

// ---------- Config: .clooks/ layout + clooks.yml ----------
function ConfigSection({ accent }) {
  const treeLines = [
    [[TK.fn, 'your-project/']],
    [[TK.op, '├── '], [TK.fn, '.clooks/']],
    [[TK.op, '│   ├── '], [TK.prop, 'clooks.yml'],            [TK.com, '         # hooks + config (committed)']],
    [[TK.op, '│   ├── '], [TK.prop, 'clooks.schema.json'],    [TK.com, '  # editor validation']],
    [[TK.op, '│   ├── '], [TK.prop, 'hooks.lock'],            [TK.com, '         # pinned SHAs (committed)']],
    [[TK.op, '│   ├── '], [TK.fn, 'bin/entrypoint.sh'],        [TK.com, '   # registered into .claude/settings.json']],
    [[TK.op, '│   └── '], [TK.fn, 'hooks/'],                   [TK.com, '             # your .ts hooks + types.d.ts']],
    [[TK.op, '└── '], [TK.fn, '.claude/settings.json'],        [TK.com, '   # auto-managed']],
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
    <section id="config" style={{ padding: '96px 32px', borderBottom: `1px solid ${COL.line}` }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Config</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 780,
        }}>
          Everything lives in <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85em' }}>.clooks/</code>.<br/>
          <span style={{ color: COL.fgMute }}>Committed. Portable. Reviewable.</span>
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 48px', lineHeight: 1.6 }}>
          <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>clooks init</code> writes a
          self-contained folder. The entrypoint script is the only thing registered into
          <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}> .claude/settings.json</code>.
          Clone the repo on another machine — same hooks, same SHAs.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
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
      blurb: 'Skip the plugin and install the runtime yourself. Works the same post-init — the plugin path is just a convenience wrapper.',
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
        { t: 'Clone the repo',
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
    <section id="install" style={{ padding: '96px 32px', borderBottom: `1px solid ${COL.line}` }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Install</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 780,
        }}>
          Three paths, one destination.
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 40px', lineHeight: 1.6 }}>
          All three paths converge on a repo with a committed <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>.clooks/</code> directory and the Clooks binary on your PATH. Pick the one that fits your situation.
        </p>

        <div style={{
          display: 'flex', gap: 0, marginBottom: 0, borderBottom: `1px solid ${COL.line}`,
        }}>
          {Object.entries(paths).map(([key, p]) => (
            <button key={key} onClick={() => setPath(key)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '12px 20px 14px', fontSize: 13, fontFamily: 'inherit',
              color: path === key ? COL.fg : COL.fgMute,
              borderBottom: `2px solid ${path === key ? accent : 'transparent'}`,
              marginBottom: -1,
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
              display: 'grid', gridTemplateColumns: '64px 1fr 1.2fr', gap: 40,
              padding: '28px 0', borderTop: `1px solid ${COL.line}`,
              alignItems: 'start',
            }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
                color: accent, paddingTop: 4,
              }}>
                0{i + 1}
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 500, color: COL.fg, marginBottom: 8, letterSpacing: -0.2 }}>
                  {s.t}
                </div>
                <div style={{ fontSize: 14, color: COL.fgMute, lineHeight: 1.55, maxWidth: 440 }}>
                  {s.d}
                </div>
              </div>
              <CmdBox accent={accent} cmd={s.cmd} slash={s.slash} comment={s.comment}/>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${COL.line}` }}/>
        </div>

        <div style={{
          marginTop: 40, padding: '20px 24px',
          background: COL.bgSoft, border: `1px solid ${COL.line}`,
          display: 'grid', gridTemplateColumns: '60px 1fr', gap: 16, alignItems: 'start',
        }}>
          <span style={{
            color: accent, fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', paddingTop: 2,
          }}>Heads up</span>
          <div style={{ fontSize: 14, color: COL.fgMute, lineHeight: 1.65 }}>
            <div style={{ marginBottom: 6 }}>
              • Global mode: add <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>clooks init --global</code> to register hooks under <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>~/.clooks/</code> for every Claude Code session.
            </div>
            <div>
              • Windows is deferred — Bun's compiled-binary story isn't stable there yet.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Comparison table ----------
function ComparisonSection({ accent }) {
  const rows = [
    ['Failure mode',           'Fail-open on anything but exit 2',           'Fail-closed by default (configurable)'],
    ['Language',               'Bash strings in JSON',                        'TypeScript, typed end to end'],
    ['Composition',            'All hooks parallel, no ordering',             'Parallel or sequential with explicit order'],
    ['Input modification',     'Not supported',                               'Sequential pipeline; hooks see previous updatedInput'],
    ['Retries',                'Per invocation only',                         'Circuit breaker auto-disables after N failures'],
    ['Distribution',           'Copy-paste from gists',                       'Marketplace, SHA-pinned, lockfile-verified'],
    ['Portability',            'Lives in your settings',                      'Vendored into .clooks/, committed'],
  ];
  return (
    <section style={{ padding: '96px 32px', borderBottom: `1px solid ${COL.line}`, background: COL.bgElev }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>vs. native hooks</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 40px', maxWidth: 640,
        }}>
          Seven concrete differences.
        </h2>
        <div style={{ border: `1px solid ${COL.line}` }}>
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
          {rows.map(([k, a, b], i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1.6fr',
              padding: '18px 20px', borderBottom: i < rows.length - 1 ? `1px solid ${COL.line}` : 'none',
              fontSize: 14, alignItems: 'start',
            }}>
              <span style={{ color: COL.fg, fontWeight: 500 }}>{k}</span>
              <span style={{ color: COL.fgMute }}>{a}</span>
              <span style={{ color: COL.fg }}>{b}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------- Why not a plugin? ----------
function WhyNotPluginSection({ accent }) {
  return (
    <section style={{ padding: '96px 32px', borderBottom: `1px solid ${COL.line}` }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Clarification</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 24px',
        }}>
          Why isn't Clooks <em style={{ fontStyle: 'italic', color: COL.fgMute }}>just</em> a Claude Code plugin?
        </h2>
        <p style={{ fontSize: 16, color: COL.fgMute, lineHeight: 1.65, margin: '0 0 16px' }}>
          It uses the plugin system for distribution — that's how you install it. But
          the runtime itself can't live inside the plugin sandbox.
        </p>
        <p style={{ fontSize: 16, color: COL.fgMute, lineHeight: 1.65, margin: '0 0 16px' }}>
          Plugins can't install binaries. Plugins can't rewrite
          <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}> .claude/settings.json</code> to register
          an entrypoint. Plugins can't run a TypeScript hook pipeline with a circuit breaker and a lockfile.
          Clooks has to be a standalone binary that the plugin drops onto your PATH.
        </p>
        <p style={{ fontSize: 16, color: COL.fgMute, lineHeight: 1.65, margin: 0 }}>
          The upside: the same binary works outside Claude Code. Cursor, Windsurf, and Copilot
          support is mapped out but not yet implemented — tracking as planned.
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
    { k: 'Windsurf', status: 'planned', note: 'event mapping researched' },
    { k: 'VS Code Copilot', status: 'planned', note: 'event mapping researched' },
    { k: 'Windows', status: 'deferred', note: 'Bun compiled-binary issues' },
  ];
  const color = (s) =>
    s === 'shipping' ? COL.green :
    s === 'wip' ? accent :
    s === 'planned' ? COL.fgMute :
    COL.fgFaint;
  return (
    <section style={{ padding: '96px 32px', borderBottom: `1px solid ${COL.line}`, background: COL.bgElev }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Roadmap</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 40px', maxWidth: 640,
        }}>
          Where things stand at <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85em' }}>v0.0.1</code>.
        </h2>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0,
          border: `1px solid ${COL.line}`,
        }}>
          {items.map((it, i) => (
            <div key={it.k} style={{
              padding: '22px 24px',
              borderRight: i % 3 !== 2 ? `1px solid ${COL.line}` : 'none',
              borderBottom: i < items.length - (items.length % 3 || 3) ? `1px solid ${COL.line}` : 'none',
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
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------- FAQ ----------
function FAQSection({ accent }) {
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
      q: 'What about other agents — Cursor, Windsurf, Copilot?',
      a: 'Planned. We\'d like clooks to be cross-agent down the line, but we need to research how to fit all APIs under one umbrella first.',
    },
  ];
  return (
    <section id="faq" style={{ padding: '96px 32px', borderBottom: `1px solid ${COL.line}` }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <SectionLabel accent={accent}>FAQ</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 40px',
        }}>
          Answers that come up often.
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
  return (
    <footer style={{ padding: '60px 32px 40px' }}>
      <div style={{
        maxWidth: 1120, margin: '0 auto',
        display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 40,
      }}>
        <div>
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

// ---------- Real captures: three annotated TUI transcripts ----------
function CapturesSection({ accent }) {
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
      tab: '02 · Crash, fail-closed',
      title: 'A hook crashes. The action is blocked.',
      blurb: <>With <code style={codeInline}>onError: "block"</code> — the default — a runtime error aborts the tool call. Native hooks pass through on anything but a clean exit 2. Clooks doesn't.</>,
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
        [['a', '● '], ['f', 'The "crashy-linter" hook crashed with a TypeError and blocked the']],
        [['f', '  action per fail-closed behavior.']],
      ],
      annotations: [
        { label: 'Structured failure', color: accent, note: 'hook name, event, exception class, message — all captured' },
        { label: 'Fail-closed', color: COL.red, note: 'action refused. Native hooks would have passed through.' },
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
        { label: 'Developer-delight', color: accent, note: 'hook failures surface in the agent loop — no silent passthrough' },
        { label: 'Context injection', color: COL.green, note: 'the error is data the agent can reason about, not a dead exit code' },
      ],
    },
  ];

  const cap = captures[active];

  return (
    <section id="captures" style={{ padding: '96px 32px', borderBottom: `1px solid ${COL.line}`, background: COL.bgElev }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Real captures</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 820,
        }}>
          Three scenarios, captured from the TUI.
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 680, margin: '0 0 36px', lineHeight: 1.6 }}>
          Recorded against a real Claude Code session.
        </p>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 0, borderBottom: `1px solid ${COL.line}`, marginBottom: 28,
        }}>
          {captures.map((c, i) => (
            <button key={c.id} onClick={() => setActive(i)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '12px 20px 14px', fontSize: 13, fontFamily: 'inherit',
              color: active === i ? COL.fg : COL.fgMute,
              borderBottom: `2px solid ${active === i ? accent : 'transparent'}`,
              marginBottom: -1, letterSpacing: 0.2,
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
          display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 32,
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
      fontFamily: 'JetBrains Mono, monospace', fontSize: 13, lineHeight: 1.6,
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

Object.assign(window, {
  ProblemSection, HookAnatomySection, ConfigSection, InstallSection,
  ComparisonSection, WhyNotPluginSection, RoadmapSection, FAQSection,
  CapturesSection, Footer,
});
