function ConfigSection({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;
  const treeLines = [
    [[TK.fn, 'your-project/']],
    [[TK.op, '├── '], [TK.fn, '.clooks/']],
    [[TK.op, '│   ├── '], [TK.prop, 'clooks.yml'],                 [TK.com, '             # hooks + config']],
    [[TK.op, '│   ├── '], [TK.prop, 'clooks.schema.json'],         [TK.com, '     # editor validation']],
    [[TK.op, '│   ├── '], [TK.fn, 'bin/entrypoint.sh'],             [TK.com, '      # bash launcher']],
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
    <section id="config" className="section">
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Config</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 20px', maxWidth: 780,
        }}>
          Everything lives in <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85em' }}>.clooks/</code>.<br/>
          <span style={{ color: COL.fgMute }}>Committed with the rest of your{'\u00a0'}code.</span>
        </h2>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 48px', lineHeight: 1.6 }}>
          <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>clooks init</code> writes a
          self-contained folder. Only the entrypoint script is registered into
          <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}> .claude/settings.json</code>.
          A teammate cloning the repo gets the same hooks as they're checked{'\u00a0'}in.
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

Object.assign(window, { ConfigSection });
