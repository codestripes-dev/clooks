function FAQSection({ accent }) {
  const vp = useViewport();
  const faqs = [
    {
      q: 'Why not just write bash?',
      a: 'Bash is great for 3 lines. Past that you want imports, types, and tests — and you want them to keep working when the agent does something surprising. Clooks gives you TypeScript with typed event contracts; you can still shell out from inside a hook.',
    },
    {
      q: 'Why Bun?',
      a: 'Bun lets Clooks run TypeScript hooks without a separate build step. Clooks ships as a single executable, so you do not need Bun installed to use it.',
    },
    {
      q: 'Does installing the plugin install the runtime?',
      a: 'No. The plugin adds a setup command and a reminder. Run /clooks:setup in Claude Code or $clooks:setup in Codex to install Clooks and configure your project. Setup reuses an existing installation. Nothing is installed automatically when a session starts.',
    },
    {
      q: 'Do I need to restart my agent?',
      a: 'Relaunch if you added Clooks to PATH while your agent was running. Claude Code may also need a reload to load a newly installed plugin. Approving plugin hooks in Codex does not itself require a restart; its setup reminder can appear on your next message.',
    },
    {
      q: 'What happens when a hook crashes?',
      a: 'By default, Clooks blocks the action when the event supports it. A hook that runs after a tool cannot undo its work, and a session-end hook cannot prevent shutdown. Set onError to "continue" or "trace" to keep going after errors. A hook is disabled after three consecutive failures by default; a successful run resets the counter.',
    },
    {
      q: 'Is there a registry of hooks I can browse?',
      a: 'Yes: browse clooks-core-hooks and clooks-project-hooks in codestripes-dev/clooks-marketplace. Install packs through Claude plugins, or use clooks add with an individual hook URL for either agent. The Codex plugin sets up Clooks but does not install hook packs. Each hook documents its supported tools and configuration.',
    },
    {
      q: 'Does ctx.ask show a native Codex approval prompt?',
      a: 'No. Claude Code shows its own approval prompt. For PreToolUse hooks on Codex, Clooks pauses the operation and tells the agent to ask you. After you approve, the agent retries using a one-time token that expires after five minutes. This relies on the agent waiting for your answer; it cannot override a blocking hook or agent permissions. The README covers the retry commands.',
    },
    {
      q: 'Which agents are supported?',
      a: 'Claude Code and Codex. Available events, tools, and hook decisions differ between agents; see the README for details. You can also use Claude Code through its IDE integrations. Other agents are not currently supported.',
    },
  ];
  return (
    <section id="faq" className="section section--elev">
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <SectionLabel accent={accent}>FAQ</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 40px',
        }}>
          Common questions.
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

Object.assign(window, { FAQSection, FAQItem });
