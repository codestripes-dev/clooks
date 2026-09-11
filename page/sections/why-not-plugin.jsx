function WhyNotPluginSection({ accent }) {
  const vp = useViewport();
  return (
    <section className="section">
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <SectionLabel accent={accent}>On the plugin system</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 24px',
        }}>
          Why isn't Clooks <em style={{ fontStyle: 'italic', color: COL.fgMute }}>just</em> a plugin?
        </h2>
        <p style={{ fontSize: 16, color: COL.fgMute, lineHeight: 1.65, margin: '0 0 16px' }}>
          Claude Code and Codex plugins help you install and configure Clooks. The runtime is a standalone binary with shared .clooks/ configuration. You can also install it without a plugin.
        </p>
        <p style={{ fontSize: 16, color: COL.fgMute, lineHeight: 1.65, margin: 0 }}>
          Run /clooks:setup in Claude Code or $clooks:setup in Codex. At startup, the plugin only reminds you if setup is needed. The Codex plugin does not install hook packs; add hooks separately with clooks add.
        </p>
      </div>
    </section>
  );
}

Object.assign(window, { WhyNotPluginSection });
