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
          Why isn't Clooks <em style={{ fontStyle: 'italic', color: COL.fgMute }}>just</em> a Claude Code plugin?
        </h2>
        <p style={{ fontSize: 16, color: COL.fgMute, lineHeight: 1.65, margin: '0 0 16px' }}>
          Clooks uses the plugin system for distribution. The runtime itself lives outside the plugin{'\u00a0'}sandbox.
        </p>
        <p style={{ fontSize: 16, color: COL.fgMute, lineHeight: 1.65, margin: 0 }}>
          A plugin <em>can</em> quietly download and install binaries on your machine, then wire them into your agent. You shouldn't be surprised by a binary landing on your machine just because you cloned a repo or installed a plugin. Clooks keeps that surface visible — the bash entrypoint sits in <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>.claude/settings.json</code>, the <code style={{ fontFamily: 'JetBrains Mono, monospace', color: COL.fg }}>.clooks/</code> directory is committed alongside your code, and pulling the runtime binary is an explicit step, not something the plugin does behind your back.
        </p>
      </div>
    </section>
  );
}

Object.assign(window, { WhyNotPluginSection });
