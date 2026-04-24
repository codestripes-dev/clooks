// ---------- Hook demos: showcase third-party hooks and their visual effects ----------
// First demo: tmux-notifications — visual tmux indicators for session state.
// Three tmux status-bar vignettes (idle / permission / reset) next to the hook
// source. Scenes auto-advance; hover to pause. Permission flash is animated.

function TmuxWindowBar({ windows, flash = 0, paneDim = false, paneContent, accent }) {
  // windows: [{ id, name, active, style: 'default'|'idleRed'|'alert' }]
  // flash: 0..1 intensity for the permission-prompt pane flash
  const paneBg = flash > 0 ? '#2a2a2a' : (paneDim ? '#0b0b0b' : '#0a0a0a');
  return (
    <div style={{
      background: paneBg,
      border: `1px solid ${COL.line}`,
      fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
      transition: 'background 120ms linear',
      display: 'flex', flexDirection: 'column',
      minHeight: 200,
    }}>
      {/* Claude Code pane content */}
      <div style={{ flex: 1, padding: '12px 14px 14px', color: COL.fgMute, fontSize: 12, lineHeight: 1.55 }}>
        {paneContent}
      </div>
      {/* tmux status bar */}
      <div style={{
        background: '#1a1a1a', borderTop: `1px solid ${COL.line}`,
        padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 11, color: COL.fgDim,
      }}>
        <span style={{ color: '#84cc16', fontWeight: 600 }}>[work]</span>
        {windows.map((w, i) => {
          const active = w.active;
          let bg = 'transparent';
          let fg = COL.fgMute;
          let bold = 400;
          if (w.style === 'idleRed') { fg = COL.red; }
          if (w.style === 'alert')   { bg = COL.red; fg = '#fff'; bold = 700; }
          if (active && w.style !== 'alert') { fg = w.style === 'idleRed' ? COL.red : COL.fg; }
          return (
            <span key={i} style={{
              background: bg, color: fg, fontWeight: bold,
              padding: '2px 8px',
              transition: 'background 140ms linear, color 140ms linear',
            }}>
              {w.id}:{w.name}{active ? '*' : ''}
            </span>
          );
        })}
        <span style={{ marginLeft: 'auto', color: COL.fgFaint, fontSize: 10 }}>
          {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · 14:22
        </span>
      </div>
    </div>
  );
}

function TmuxHookSection({ accent }) {
  const vp = useViewport();
  const stack = vp.isMobile || vp.isTablet;

  // Animate the permission-prompt flash (scene 2): 2 quick flickers then rest.
  const [tick, setTick] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  React.useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setTick(t => (t + 1) % 40), 80);
    return () => clearInterval(id);
  }, [paused]);

  // Flash pattern: ticks 0-2 on, 3-4 off, 5-7 on, 8-10 off, rest idle.
  const flashOn = (tick >= 0 && tick < 3) || (tick >= 5 && tick < 8);

  const [active, setActive] = React.useState(0);

  const tmuxScenes = [
    {
      id: 'idle',
      tag: '01 · Notification · idle_prompt',
      title: 'Claude is waiting.',
      desc: <>You asked a question and walked away. Claude finished and is back at the prompt. The tab turns red with a <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>⏸</code> prefix.</>,
      windows: [
        { id: 1, name: 'c-api',     active: false, style: 'default' },
        { id: 2, name: '⏸ c-clooks', active: true,  style: 'idleRed' },
        { id: 3, name: 'logs',       active: false, style: 'default' },
      ],
      flash: 0,
      paneDim: false,
      pane: (
        <>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Wired the entrypoint through <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>.clooks/bin/entrypoint.sh</code>.</span></div>
          <div style={{ color: COL.fgMute, paddingLeft: 14 }}>Ready for your next instruction — want me to add a smoke test?</div>
          <div style={{ height: 10 }}/>
          <div style={{
            border: `1px solid ${COL.lineStrong}`, padding: '8px 12px',
            color: COL.fgDim, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ color: accent }}>❯</span>
            <span style={{ color: COL.fgDim }}>Try "run the tests"</span>
            <span style={{
              display: 'inline-block', width: 6, height: 13, background: COL.fgDim,
              animation: 'blink 1s steps(1) infinite', marginLeft: -4,
            }}/>
          </div>
          <div style={{ marginTop: 6, fontSize: 10.5, color: COL.fgFaint }}>
            ? for help · / for commands
          </div>
        </>
      ),
      note: <>Tab: red text + <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>⏸</code> prefix.</>,
    },
    {
      id: 'permission',
      tag: '02 · Notification · permission_prompt',
      title: 'Claude wants permission.',
      desc: <>A tool call is blocked on your approval. The pane flashes twice and the tab flips to bold red — hard to miss from the next monitor over.</>,
      windows: [
        { id: 1, name: 'c-api',    active: false, style: 'default' },
        { id: 2, name: 'c-clooks', active: true,  style: 'alert' },
        { id: 3, name: 'logs',     active: false, style: 'default' },
      ],
      flash: flashOn ? 1 : 0,
      paneDim: flashOn,
      pane: (
        <>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>I'll commit the staged changes.</span></div>
          <div style={{ height: 10 }}/>
          <div style={{
            border: `1px solid ${COL.red}`,
            background: 'rgba(248,113,113,0.04)',
            padding: 0,
          }}>
            <div style={{
              padding: '8px 12px', borderBottom: `1px solid ${COL.lineStrong}`,
              fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase',
              color: COL.red, fontWeight: 600,
            }}>
              Permission required · Bash
            </div>
            <div style={{ padding: '10px 12px', color: COL.fg, fontSize: 12 }}>
              <div style={{ color: COL.fgMute, marginBottom: 6 }}>Run this command?</div>
              <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>
                git commit -m "wire entrypoint"
              </code>
            </div>
            <div style={{
              padding: '8px 12px', borderTop: `1px solid ${COL.line}`, display: 'flex', gap: 14,
              fontSize: 11, color: COL.fgMute,
            }}>
              <span><span style={{ color: accent }}>1</span> Yes</span>
              <span><span style={{ color: accent }}>2</span> Yes, always</span>
              <span><span style={{ color: accent }}>3</span> No, tell Claude what to do differently</span>
            </div>
          </div>
        </>
      ),
      note: <>Tab: red background, bold. Pane flashes twice.</>,
    },
    {
      id: 'reset',
      tag: '03 · UserPromptSubmit / PostToolUse',
      title: 'Work is happening.',
      desc: <>You replied, or a tool call finished. The tab resets to <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>c-clooks</code>.</>,
      windows: [
        { id: 1, name: 'c-api',    active: false, style: 'default' },
        { id: 2, name: 'c-clooks', active: true,  style: 'default' },
        { id: 3, name: 'logs',     active: false, style: 'default' },
      ],
      flash: 0,
      paneDim: false,
      pane: (
        <>
          <div style={{ color: COL.fgMute }}>
            <span style={{ color: accent }}>❯</span>{' '}
            <span style={{ color: COL.fg }}>run the tests</span>
          </div>
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Running the test suite.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>bun test</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> runtime/pipeline.test.ts <span style={{ color: COL.fgFaint }}>(14 tests)</span>
          </div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> config/schema.test.ts <span style={{ color: COL.fgFaint }}>(7 tests)</span>
          </div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: accent }}>…</span> hooks/no-rm-rf.test.ts
          </div>
        </>
      ),
      note: <>Tab resets to default.</>,
    },
  ];

  // Abridged hook source — real file adds a couple more tmux() calls
  // inside the helpers and handles SessionEnd cleanup.
  const tmuxHookLines = [
    [[TK.com, '// .clooks/hooks/tmux-notifications.ts']],
    [[TK.kw, 'import'], [TK.op, ' { '], [TK.fn, 'execSync'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'child_process'"]],
    [[TK.kw, 'import type'], [TK.op, ' { '], [TK.ty, 'ClooksHook'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'clooks'"]],
    '',
    [[TK.kw, 'const'], [TK.fn, ' SKIP'], [TK.op, ' = { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' } '], [TK.kw, 'as const']],
    [[TK.kw, 'const'], [TK.fn, ' sleep'], [TK.op, ' = (ms: '], [TK.ty, 'number'], [TK.op, ') => '], [TK.kw, 'new'], [TK.fn, ' Promise'], [TK.op, '(r => '], [TK.fn, 'setTimeout'], [TK.op, '(r, ms))']],
    '',
    [[TK.kw, 'function'], [TK.fn, ' tmux'], [TK.op, '(cmd: '], [TK.ty, 'string'], [TK.op, ') {']],
    ['  ', [TK.kw, 'try'], [TK.op, ' { '], [TK.fn, 'execSync'], [TK.op, '(`tmux ${cmd}`, { '], [TK.prop, 'stdio'], [TK.op, ': '], [TK.str, "'ignore'"], [TK.op, ' }) } '], [TK.kw, 'catch'], [TK.op, ' {}']],
    [[TK.op, '}']],
    '',
    [[TK.kw, 'function'], [TK.fn, ' getWindowId'], [TK.op, '() {']],
    ['  ', [TK.kw, 'const'], [TK.fn, ' pane'], [TK.op, ' = '], [TK.ty, 'process'], [TK.op, '.env.'], [TK.prop, 'TMUX_PANE']],
    ['  ', [TK.kw, 'if'], [TK.op, ' (!pane) '], [TK.kw, 'return null']],
    ['  ', [TK.kw, 'return'], [TK.fn, ' execSync'], [TK.op, '(`tmux display-message -t "${pane}" -p '], [TK.str, "'#{window_id}'"], [TK.op, '`, { '], [TK.prop, 'encoding'], [TK.op, ': '], [TK.str, "'utf8'"], [TK.op, ' }).trim()']],
    [[TK.op, '}']],
    '',
    [[TK.kw, 'const'], [TK.fn, ' dirName'], [TK.op, ' = () => '], [TK.ty, 'process'], [TK.op, '.cwd().split('], [TK.str, "'/'"], [TK.op, ').pop() ?? '], [TK.str, "'unknown'"]],
    '',
    [[TK.kw, 'function'], [TK.fn, ' resetWindow'], [TK.op, '(w: '], [TK.ty, 'string'], [TK.op, ') {']],
    ['  ', [TK.fn, 'tmux'], [TK.op, '(`set-window-option -t ${w} window-status-style default`)']],
    ['  ', [TK.fn, 'tmux'], [TK.op, '(`rename-window -t ${w} "c-${'], [TK.fn, 'dirName'], [TK.op, '()}"`)']],
    [[TK.op, '}']],
    '',
    [[TK.kw, 'async function'], [TK.fn, ' flashPane'], [TK.op, '() {']],
    ['  ', [TK.kw, 'const'], [TK.fn, ' pane'], [TK.op, ' = '], [TK.ty, 'process'], [TK.op, '.env.'], [TK.prop, 'TMUX_PANE']],
    ['  ', [TK.kw, 'for'], [TK.op, ' ('], [TK.kw, 'let'], [TK.fn, ' i'], [TK.op, ' = 0; i < 2; i++) {']],
    ['    ', [TK.fn, 'tmux'], [TK.op, '(`select-pane -t "${pane}" -P '], [TK.str, "'bg=colour240'"], [TK.op, '`)']],
    ['    ', [TK.kw, 'await'], [TK.fn, ' sleep'], [TK.op, '(150); '], [TK.fn, 'tmux'], [TK.op, '(`select-pane -t "${pane}" -P '], [TK.str, "'bg=default'"], [TK.op, '`)']],
    ['    ', [TK.kw, 'await'], [TK.fn, ' sleep'], [TK.op, '(100)']],
    ['  ', [TK.op, '}']],
    [[TK.op, '}']],
    '',
    [[TK.kw, 'let'], [TK.fn, ' w'], [TK.op, ': '], [TK.ty, 'string']],
    '',
    [[TK.kw, 'export const'], [TK.fn, ' hook'], [TK.op, ': '], [TK.ty, 'ClooksHook'], [TK.op, ' = {']],
    ['  ', [TK.prop, 'meta'], [TK.op, ': { '], [TK.prop, 'name'], [TK.op, ': '], [TK.str, "'tmux-notifications'"], [TK.op, ' },']],
    '',
    ['  ', [TK.fn, 'beforeHook'], [TK.op, '(event) {                '], [TK.com, '// lifecycle: runs before each handler']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (!'], [TK.ty, 'process'], [TK.op, '.env.'], [TK.prop, 'TMUX'], [TK.op, ') '], [TK.kw, 'return'], [TK.op, ' event.'], [TK.fn, 'respond'], [TK.op, '('], [TK.ty, 'SKIP'], [TK.op, ')']],
    ['    ', [TK.kw, 'const'], [TK.fn, ' id'], [TK.op, ' = '], [TK.fn, 'getWindowId'], [TK.op, '()']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (!id) '], [TK.kw, 'return'], [TK.op, ' event.'], [TK.fn, 'respond'], [TK.op, '('], [TK.ty, 'SKIP'], [TK.op, ')']],
    ['    w = id'],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.kw, 'async'], [TK.fn, ' Notification'], [TK.op, '(ctx) {']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (ctx.'], [TK.prop, 'notificationType'], [TK.op, ' === '], [TK.str, "'idle_prompt'"], [TK.op, ') {']],
    ['      ', [TK.fn, 'tmux'], [TK.op, '(`set-window-option -t ${w} window-status-style '], [TK.str, "'fg=red'"], [TK.op, '`)']],
    ['      ', [TK.fn, 'tmux'], [TK.op, '(`rename-window -t ${w} "⏸ c-${'], [TK.fn, 'dirName'], [TK.op, '()}"`)']],
    ['    ', [TK.op, '} '], [TK.kw, 'else if'], [TK.op, ' (']],
    ['      ', [TK.op, 'ctx.'], [TK.prop, 'notificationType'], [TK.op, ' === '], [TK.str, "'permission_prompt'"], [TK.op, ' ||']],
    ['      ', [TK.op, 'ctx.'], [TK.prop, 'notificationType'], [TK.op, ' === '], [TK.str, "'elicitation_dialog'"]],
    ['    ', [TK.op, ') {']],
    ['      ', [TK.fn, 'tmux'], [TK.op, '(`set-window-option -t ${w} window-status-style '], [TK.str, "'bg=red,fg=white,bold'"], [TK.op, '`)']],
    ['      ', [TK.kw, 'await'], [TK.fn, ' flashPane'], [TK.op, '()']],
    ['    ', [TK.op, '}']],
    ['    ', [TK.kw, 'return'], [TK.ty, ' SKIP']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'UserPromptSubmit'], [TK.op, '() { '], [TK.fn, 'resetWindow'], [TK.op, '(w); '], [TK.kw, 'return'], [TK.ty, ' SKIP'], [TK.op, ' },']],
    ['  ', [TK.fn, 'PostToolUse'], [TK.op, '()      { '], [TK.fn, 'resetWindow'], [TK.op, '(w); '], [TK.kw, 'return'], [TK.ty, ' SKIP'], [TK.op, ' },']],
    ['  ', [TK.fn, 'SessionStart'], [TK.op, '()     { '], [TK.fn, 'resetWindow'], [TK.op, '(w); '], [TK.kw, 'return'], [TK.ty, ' SKIP'], [TK.op, ' },']],
    [[TK.op, '}']],
  ];

  // ---- demo 2: js-package-manager-guard ----
  // Heavily simplified: the real file handles compound commands, VAR= prefixes,
  // quoted strings, per-role suggestions (pm/runner/runtime), auto-extension
  // (npm→npx+node, bun→bunx), additionalBlocked, and an unconfigured-session
  // warning. Here we show only the core block flow.
  const pkgHookLines = [
    [[TK.com, '// .clooks/hooks/js-package-manager-guard.ts']],
    [[TK.kw, 'import type'], [TK.op, ' { '], [TK.ty, 'ClooksHook'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'clooks'"]],
    '',
    [[TK.kw, 'type'], [TK.ty, ' Config'], [TK.op, ' = { '], [TK.prop, 'allowed'], [TK.op, ': '], [TK.ty, 'string'], [TK.op, '[] }']],
    '',
    [[TK.kw, 'const'], [TK.fn, ' KNOWN'], [TK.op, ' = '], [TK.kw, 'new'], [TK.fn, ' Set'], [TK.op, '([']],
    ['  ', [TK.str, "'npm'"], [TK.op, ', '], [TK.str, "'npx'"], [TK.op, ', '], [TK.str, "'node'"], [TK.op, ',']],
    ['  ', [TK.str, "'yarn'"], [TK.op, ', '], [TK.str, "'pnpm'"], [TK.op, ', '], [TK.str, "'pnpx'"], [TK.op, ',']],
    ['  ', [TK.str, "'bun'"], [TK.op, ', '], [TK.str, "'bunx'"], [TK.op, ', '], [TK.str, "'deno'"], [TK.op, ',']],
    [[TK.op, '])']],
    '',
    [[TK.kw, 'const'], [TK.fn, ' firstWord'], [TK.op, ' = (cmd: '], [TK.ty, 'string'], [TK.op, ') =>']],
    ['  cmd.', [TK.fn, 'trim'], [TK.op, '().'], [TK.fn, 'split'], [TK.op, '(/\\s+/)[0] ?? '], [TK.str, "''"]],
    '',
    [[TK.kw, 'export const'], [TK.fn, ' hook'], [TK.op, ': '], [TK.ty, 'ClooksHook'], [TK.op, '<'], [TK.ty, 'Config'], [TK.op, '> = {']],
    ['  ', [TK.prop, 'meta'], [TK.op, ': {']],
    ['    ', [TK.prop, 'name'], [TK.op, ': '], [TK.str, "'js-package-manager-guard'"], [TK.op, ',']],
    ['    ', [TK.prop, 'config'], [TK.op, ': { '], [TK.prop, 'allowed'], [TK.op, ': [] },']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'PreToolUse'], [TK.op, '(ctx, config) {']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (ctx.'], [TK.prop, 'toolName'], [TK.op, ' !== '], [TK.str, "'Bash'"], [TK.op, ') '], [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    '',
    ['    ', [TK.kw, 'const'], [TK.fn, ' tool'], [TK.op, '    = '], [TK.fn, 'firstWord'], [TK.op, '('], [TK.ty, 'String'], [TK.op, '(ctx.'], [TK.prop, 'toolInput'], [TK.op, '.command ?? '], [TK.str, "''"], [TK.op, '))']],
    ['    ', [TK.kw, 'const'], [TK.fn, ' allowed'], [TK.op, ' = '], [TK.kw, 'new'], [TK.fn, ' Set'], [TK.op, '(config.'], [TK.prop, 'allowed'], [TK.op, ')']],
    '',
    ['    ', [TK.kw, 'if'], [TK.op, ' (!'], [TK.fn, 'KNOWN'], [TK.op, '.has(tool) || allowed.has(tool)) {']],
    ['      ', [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    ['    ', [TK.op, '}']],
    '',
    ['    ', [TK.kw, 'const'], [TK.fn, ' use'], [TK.op, ' = config.'], [TK.prop, 'allowed'], [TK.op, '[0] ?? '], [TK.str, "'<none>'"]],
    ['    ', [TK.kw, 'return'], [TK.op, ' {']],
    ['      ', [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'block'"], [TK.op, ',']],
    ['      ', [TK.prop, 'reason'], [TK.op, ': `This project uses '], [TK.str, "'${use}'"], [TK.op, '. Use '], [TK.str, "'${use}'"], [TK.op, ' instead of '], [TK.str, "'${tool}'"], [TK.op, '.`,']],
    ['    ', [TK.op, '}']],
    ['  ', [TK.op, '},']],
    [[TK.op, '}']],
  ];

  // Plain Claude Code pane (no tmux bar) for non-tmux scenes.
  const ccPane = (children) => (
    <div style={{
      background: COL.bgCode,
      border: `1px solid ${COL.line}`,
      fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
      color: COL.fgMute, lineHeight: 1.55,
      padding: '14px 16px', minHeight: 200,
    }}>
      {children}
    </div>
  );

  const blockBanner = (reason) => (
    <>
      <div style={{ color: COL.red }}>{'  ⎿  '}PreToolUse:Bash hook returned blocking error</div>
      <div style={{ color: COL.fg, paddingLeft: 22 }}>{reason}</div>
    </>
  );

  const pkgScenes = [
    {
      id: 'npm',
      tag: '01 · PreToolUse · Bash',
      title: 'Wrong package manager. Blocked and\u00a0retried.',
      pane: (
        <>
          <div><span style={{ color: accent }}>❯</span> <span style={{ color: COL.fg }}>add react-query to the project</span></div>
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>I'll install @tanstack/react-query.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>npm install @tanstack/react-query</span></div>
          {blockBanner(<>This project uses <span style={{ color: COL.yellow }}>'bun'</span>. Use <span style={{ color: COL.yellow }}>'bun'</span> instead of <span style={{ color: COL.yellow }}>'npm'</span>.</>)}
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Got it — this project uses bun. Let me retry.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>bun add @tanstack/react-query</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> installed @tanstack/react-query@5.62.7
          </div>
        </>
      ),
      note: <>Reason string travels back. Claude self-corrects.</>,
    },
    {
      id: 'node',
      tag: '02 · PreToolUse · Bash',
      title: 'Same guard catches the runtime.',
      pane: (
        <>
          <div><span style={{ color: accent }}>❯</span> <span style={{ color: COL.fg }}>run the migration script</span></div>
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Running scripts/migrate.js.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>node scripts/migrate.js</span></div>
          {blockBanner(<>This project uses <span style={{ color: COL.yellow }}>'bun'</span>. Use <span style={{ color: COL.yellow }}>'bun'</span> instead of <span style={{ color: COL.yellow }}>'node'</span>.</>)}
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Using bun instead.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>bun scripts/migrate.js</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> Migrated 1,482 rows in 340ms
          </div>
        </>
      ),
      note: <>One rule, two symptoms — <span style={{ color: COL.fg }}>node</span> is in the known{'\u00a0'}set.</>,
    },
  ];

  const mvHookLines = [
    [[TK.com, '// .clooks/hooks/no-bare-mv.ts']],
    [[TK.kw, 'import type'], [TK.op, ' { '], [TK.ty, 'ClooksHook'], [TK.op, ' } '], [TK.kw, 'from'], [TK.str, " 'clooks'"]],
    '',
    [[TK.kw, 'const'], [TK.fn, ' startsWithMv'], [TK.op, ' = (cmd: '], [TK.ty, 'string'], [TK.op, ') =>']],
    ['  /^\\s*', [TK.str, 'mv'], [TK.op, '(\\s|$)/.test(cmd)']],
    '',
    [[TK.kw, 'export const'], [TK.fn, ' hook'], [TK.op, ': '], [TK.ty, 'ClooksHook'], [TK.op, ' = {']],
    ['  ', [TK.prop, 'meta'], [TK.op, ': {']],
    ['    ', [TK.prop, 'name'], [TK.op, ': '], [TK.str, "'no-bare-mv'"], [TK.op, ',']],
    ['    ', [TK.prop, 'description'], [TK.op, ': '], [TK.str, "'Rewrite bare mv to git mv.'"], [TK.op, ',']],
    ['  ', [TK.op, '},']],
    '',
    ['  ', [TK.fn, 'PreToolUse'], [TK.op, '(ctx) {']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (ctx.'], [TK.prop, 'toolName'], [TK.op, ' !== '], [TK.str, "'Bash'"], [TK.op, ') '], [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    ['    ', [TK.kw, 'const'], [TK.fn, ' cmd'], [TK.op, ' = '], [TK.ty, 'String'], [TK.op, '(ctx.'], [TK.prop, 'toolInput'], [TK.op, '.command ?? '], [TK.str, "''"], [TK.op, ')']],
    ['    ', [TK.kw, 'if'], [TK.op, ' (!'], [TK.fn, 'startsWithMv'], [TK.op, '(cmd)) '], [TK.kw, 'return'], [TK.op, ' { '], [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'skip'"], [TK.op, ' }']],
    '',
    ['    ', [TK.kw, 'const'], [TK.fn, ' rewritten'], [TK.op, ' = cmd.'], [TK.fn, 'replace'], [TK.op, '(/^\\s*mv\\b/, '], [TK.str, "'git mv'"], [TK.op, ')']],
    ['    ', [TK.kw, 'return'], [TK.op, ' {']],
    ['      ', [TK.prop, 'result'], [TK.op, ': '], [TK.str, "'updateInput'"], [TK.op, ',']],
    ['      ', [TK.prop, 'updatedInput'], [TK.op, ': { ...ctx.'], [TK.prop, 'toolInput'], [TK.op, ', '], [TK.prop, 'command'], [TK.op, ': rewritten },']],
    ['      ', [TK.prop, 'note'], [TK.op, ': '], [TK.str, "'rewrote mv → git mv'"], [TK.op, ',']],
    ['    ', [TK.op, '}']],
    ['  ', [TK.op, '},']],
    [[TK.op, '}']],
  ];

  const rewriteNotice = (from, to) => (
    <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
      <span style={{ color: COL.yellow }}>clooks</span> · no-bare-mv rewrote <span style={{ color: COL.fg }}>{from}</span> → <span style={{ color: COL.fg }}>{to}</span>
    </div>
  );

  const mvScenes = [
    {
      id: 'rename',
      tag: '01 · PreToolUse · Bash',
      title: 'Bare mv, silently upgraded.',
      pane: (
        <>
          <div><span style={{ color: accent }}>❯</span> <span style={{ color: COL.fg }}>rename src/auth/login.ts to session.ts</span></div>
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>I'll rename the file.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>mv src/auth/login.ts src/auth/session.ts</span></div>
          {rewriteNotice('mv', 'git mv')}
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>git mv src/auth/login.ts src/auth/session.ts</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> renamed, history preserved
          </div>
        </>
      ),
      note: <>No block, no retry — the call runs once, already corrected.</>,
    },
    {
      id: 'multi',
      tag: '02 · PreToolUse · Bash',
      title: 'Same rewrite, same pattern.',
      pane: (
        <>
          <div><span style={{ color: accent }}>❯</span> <span style={{ color: COL.fg }}>move a.ts and b.ts into helpers/</span></div>
          <div style={{ height: 8 }}/>
          <div><span style={{ color: accent }}>●</span> <span style={{ color: COL.fg }}>Moving two files.</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>mv src/util/a.ts src/util/b.ts src/helpers/</span></div>
          {rewriteNotice('mv', 'git mv')}
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>Bash · <span style={{ color: COL.fgMute }}>git mv src/util/a.ts src/util/b.ts src/helpers/</span></div>
          <div style={{ color: COL.fgDim, paddingLeft: 14 }}>
            {'  ⎿  '}<span style={{ color: COL.green }}>✓</span> 2 files moved
          </div>
        </>
      ),
      note: <>The shell sees the rewritten command; Claude never sees a block.</>,
    },
  ];

  const demos = [
    {
      id: 'pkg',
      tab: 'js-package-manager-guard',
      filename: 'js-package-manager-guard.ts',
      pack: 'clooks-project-hooks',
      kind: 'transcript',
      hookLines: pkgHookLines,
      scenes: pkgScenes,
      elided: <>Simplified for display.</>,
      heading: <>Block with a reason,<br/><span style={{ color: COL.fgMute }}>let Claude retry.</span></>,
      lead: <><code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>js-package-manager-guard</code> stops Claude from reaching for the wrong package manager. The block reason tells Claude what to do instead — it self-corrects on the next tool call.</>,
    },
    {
      id: 'mv',
      tab: 'no-bare-mv',
      filename: 'no-bare-mv.ts',
      pack: 'clooks-core-hooks',
      kind: 'transcript',
      hookLines: mvHookLines,
      scenes: mvScenes,
      elided: <>Simplified for display.</>,
      heading: <>Rewrite the tool call<br/><span style={{ color: COL.fgMute }}>instead of blocking.</span></>,
      lead: <><code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>no-bare-mv</code> catches a plain <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>mv</code> and swaps it for <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>git mv</code> in flight. The tool call runs once with the rewritten command; the agent doesn't see a block.</>,
    },
    {
      id: 'tmux',
      tab: 'tmux-notifications',
      filename: 'tmux-notifications.ts',
      pack: 'clooks-core-hooks',
      kind: 'tmux',
      hookLines: tmuxHookLines,
      scenes: tmuxScenes,
      elided: <>Simplified for display.</>,
      heading: <>Show agent state<br/><span style={{ color: COL.fgMute }}>in your terminal.</span></>,
      lead: <><code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>tmux-notifications</code> restyles the current tmux window when Claude changes state — idle, asking for permission, or back to work. The status bar carries the signal.</>,
    },
  ];
  const demo = demos[active];

  const [expanded, setExpanded] = React.useState(!vp.isMobile);
  React.useEffect(() => { setExpanded(!vp.isMobile); }, [active, vp.isMobile]);

  return (
    <section id="demos" className="section section--elev"
    onPointerEnter={(e) => { if (e.pointerType === 'mouse') setPaused(true); }}
    onPointerLeave={(e) => { if (e.pointerType === 'mouse') setPaused(false); }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <SectionLabel accent={accent}>Hook demos</SectionLabel>

        {/* Tab bar — above the heading so each demo can set its own framing */}
        <div style={{
          display: 'flex', gap: 0, marginBottom: 32,
        }}>
          {demos.map((d, i) => (
            <button key={d.id} onClick={() => setActive(i)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: vp.isMobile ? '10px 6px 12px' : '12px 20px 14px',
              fontSize: vp.isMobile ? 11 : 13,
              fontFamily: 'JetBrains Mono, monospace',
              whiteSpace: 'nowrap',
              color: active === i ? COL.fg : COL.fgMute,
              borderBottom: `2px solid ${active === i ? accent : 'transparent'}`,
              letterSpacing: 0.2,
              flex: vp.isMobile ? '1 1 0' : '0 0 auto',
              textAlign: vp.isMobile ? 'center' : 'left',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>{d.tab}</button>
          ))}
        </div>

        <h2 style={{
          fontSize: 'clamp(32px, 3.6vw, 46px)', lineHeight: 1.1,
          letterSpacing: -1, fontWeight: 500, margin: '0 0 14px', maxWidth: 860,
        }}>
          {demo.heading}
        </h2>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5,
          letterSpacing: 0.6, color: COL.fgMute, marginBottom: 18,
        }}>
          from <a
            href={`https://github.com/codestripes-dev/clooks-marketplace/tree/main/${demo.pack}`}
            style={{ color: accent, textDecoration: 'none' }}
          >{demo.pack}</a>
        </div>
        <p style={{ fontSize: 15, color: COL.fgMute, maxWidth: 640, margin: '0 0 40px', lineHeight: 1.65 }}>
          {demo.lead}
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: stack ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1.1fr)',
          gap: stack ? 32 : 40, alignItems: 'start',
        }}>
          {/* Left: scenes (the demo — primary content) */}
          <div>
            {demo.scenes.map((s, i) => (
              <div key={s.id} style={{
                padding: '20px 0 28px',
                borderTop: `1px solid ${COL.line}`,
                borderBottom: i === demo.scenes.length - 1 ? `1px solid ${COL.line}` : 'none',
              }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                  letterSpacing: 0.6, color: accent, marginBottom: 8,
                }}>{s.tag}</div>
                <div style={{
                  fontSize: 17, color: COL.fg, fontWeight: 500, letterSpacing: -0.2,
                  marginBottom: 14,
                }}>{s.title}</div>

                {demo.kind === 'tmux' ? (
                  <TmuxWindowBar
                    windows={s.windows}
                    flash={s.flash}
                    paneDim={s.paneDim}
                    paneContent={s.pane}
                    accent={accent}
                  />
                ) : (
                  ccPane(s.pane)
                )}

                <div style={{
                  marginTop: 12, fontSize: 12, color: COL.fgMute,
                  fontFamily: 'JetBrains Mono, monospace', letterSpacing: 0.2,
                }}>
                  {s.note}
                </div>
              </div>
            ))}
          </div>

          {/* Right (desktop) / top (stacked): abridged hook source, collapsed by default. */}
          <div style={{
            background: COL.bgCode, border: `1px solid ${COL.line}`,
            fontFamily: 'JetBrains Mono, monospace', fontSize: vp.isMobile ? 9 : 12,
            lineHeight: 1.65, overflow: 'hidden',
            position: stack ? 'static' : (expanded ? 'sticky' : 'static'), top: 96,
            order: stack ? -1 : 0,
          }}>
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              style={{
                all: 'unset', boxSizing: 'border-box', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '10px 14px',
                borderBottom: expanded ? `1px solid ${COL.line}` : 'none',
                fontSize: 11, color: COL.fgDim,
                fontFamily: 'JetBrains Mono, monospace',
              }}
              aria-expanded={expanded}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, background: '#4a4a4a', display: 'inline-block' }}/>
                {demo.filename}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
                <span>simplified</span>
                <span style={{ color: accent, letterSpacing: 0.5, textTransform: 'none', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {expanded ? 'hide source\u00a0▴' : 'show source\u00a0▾'}
                </span>
              </span>
            </button>
            {expanded && (
              <>
                <div style={{ display: 'flex', padding: '14px 0' }}>
                  <div style={{
                    padding: vp.isMobile ? '0 8px' : '0 12px', color: COL.fgFaint, textAlign: 'right',
                    borderRight: `1px solid ${COL.line}`, userSelect: 'none',
                    minWidth: vp.isMobile ? 28 : 36,
                  }}>
                    {demo.hookLines.map((_, i) => <div key={i}>{i + 1}</div>)}
                  </div>
                  <div style={{ padding: vp.isMobile ? '0 10px' : '0 14px', flex: 1, minWidth: 0, overflowX: vp.isMobile ? 'visible' : 'auto' }}>
                    {demo.hookLines.map((l, i) => (
                      <div key={i} style={{
                        whiteSpace: vp.isMobile ? 'pre-wrap' : 'pre',
                        overflowWrap: vp.isMobile ? 'anywhere' : 'normal',
                        minHeight: (vp.isMobile ? 9 : 12) * 1.65,
                      }}>
                        {renderLine(l)}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{
                  padding: '10px 14px', borderTop: `1px solid ${COL.line}`,
                  fontSize: 10.5, color: COL.fgDim, letterSpacing: 0.3,
                  display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                }}>
                  <span>{demo.elided}</span>
                  <span><a href="https://github.com/codestripes-dev/clooks-marketplace" style={{ color: accent, textDecoration: 'none' }}>full source →</a></span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { TmuxHookSection, TmuxWindowBar });
