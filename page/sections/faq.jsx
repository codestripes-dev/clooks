function FAQSection({ accent }) {
  const vp = useViewport();
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
      q: 'What about other agents — Cursor, Codex, OpenCode, OpenClaw?',
      a: 'Planned. We\'d like clooks to be cross-agent down the line, but we need to research how to fit all APIs under one umbrella first.',
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
