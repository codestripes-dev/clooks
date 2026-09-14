function WhyNotPluginSection({ accent, content }) {
  const vp = useViewport();
  return (
    <section className="section">
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <SectionLabel accent={accent}>{content.label}</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 24px',
        }}>
          <Copy text={content.title} heading/>
        </h2>
        <p style={{ fontSize: 16, color: COL.fgMute, lineHeight: 1.65, margin: '0 0 16px' }}>
          <Copy text={content.intro}/>
        </p>
        <p style={{ fontSize: 16, color: COL.fgMute, lineHeight: 1.65, margin: 0 }}>
          <Copy text={content.setup}/>
        </p>
      </div>
    </section>
  );
}

Object.assign(window, { WhyNotPluginSection });
