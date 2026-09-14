function FAQSection({ accent, content }) {
  const vp = useViewport();
  const faqs = content.faqs;
  return (
    <section id="faq" className="section section--elev">
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <SectionLabel accent={accent}>{content.label}</SectionLabel>
        <h2 style={{
          fontSize: 'clamp(28px, 3vw, 38px)', lineHeight: 1.15,
          letterSpacing: -0.8, fontWeight: 500, margin: '0 0 40px',
        }}>
          <Copy text={content.title} heading/>
        </h2>
        {/* Reset open items when the editor changes the questions. */}
        <div key={JSON.stringify(faqs)}>
          {faqs.map((f, i) => <FAQItem key={i} q={f.q} a={f.a} accent={accent} last={i === faqs.length - 1}/>)}
        </div>
      </div>
    </section>
  );
}

function FAQItem({ q, a, accent, last }) {
  const { editing } = usePageEnvironment();
  const [open, setOpen] = React.useState(editing);
  return (
    <div style={{
      borderTop: `1px solid ${COL.line}`,
      borderBottom: last ? `1px solid ${COL.line}` : 'none',
    }}>
      <button aria-expanded={open} onClick={() => setOpen(o => !o)} style={{
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
        <div hidden={!open} style={{
          padding: '0 0 24px', fontSize: 15, color: COL.fgMute,
          lineHeight: 1.65, maxWidth: 680,
        }}>{a}</div>
    </div>
  );
}

Object.assign(window, { FAQSection, FAQItem });
