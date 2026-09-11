// Clooks landing site — core (nav, logo, tweaks, palette)
// ------------------------------------------------------------

const COL = {
  bg: '#0a0a0a',
  bgElev: '#0f0f0f',
  bgCode: '#0c0c0c',
  bgSoft: '#131313',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.14)',
  fg: '#f5f5f2',
  fgMute: '#a1a1aa',
  fgDim: '#71717a',
  fgFaint: '#52525b',
  red: '#f87171',
  green: '#34d399',
  yellow: '#fbbf24',
};

function Logo({ accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }}>
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" style={{ display: 'block' }}>
        <path d="M4 4 L4 18 L10 18" stroke={accent} strokeWidth="2" strokeLinecap="square" fill="none"/>
        <path d="M18 4 L18 18 L12 18" stroke={COL.fg} strokeWidth="2" strokeLinecap="square" fill="none"/>
      </svg>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 15, fontWeight: 600, letterSpacing: -0.3 }}>
        clooks
      </span>
    </div>
  );
}

function Nav({ accent }) {
  const vp = useViewport();
  const linkStyle = { color: COL.fgMute, fontSize: 13, textDecoration: 'none', padding: '6px 0' };
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      borderBottom: `1px solid ${COL.line}`,
      background: 'rgba(10,10,10,0.75)', backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
    }}>
      <div style={{
        maxWidth: 1120, margin: '0 auto',
        padding: bp(vp, { mobile: '14px 18px', tablet: '16px 24px', desktop: '16px 32px' }),
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Logo accent={accent} />
        <nav style={{
          display: 'flex', alignItems: 'center',
          gap: bp(vp, { mobile: 12, tablet: 20, desktop: 28 }),
        }}>
          {!vp.isMobile && !vp.isTablet && (
            <>
              <a href="#problem" style={linkStyle}>Why</a>
              <a href="#hook" style={linkStyle}>Hook API</a>
              <a href="#config" style={linkStyle}>Config</a>
              <a href="#install" style={linkStyle}>Install</a>
              <a href="#faq" style={linkStyle}>FAQ</a>
            </>
          )}
          {vp.isTablet && (
            <>
              <a href="#hook" style={linkStyle}>Hook API</a>
              <a href="#install" style={linkStyle}>Install</a>
            </>
          )}
          <a href="https://github.com/codestripes-dev/clooks" style={linkStyle} aria-label="GitHub">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              {!vp.isMobile && 'GitHub'}
            </span>
          </a>
          <a href="#install" style={{
            fontSize: 13, color: COL.bg, background: accent,
            padding: vp.isMobile ? '6px 10px' : '7px 14px',
            textDecoration: 'none', fontWeight: 500,
          }}>Install{vp.isMobile ? '' : ' →'}</a>
        </nav>
      </div>
    </header>
  );
}

function SectionLabel({ accent, children }) {
  return (
    <div style={{
      fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: 2,
      textTransform: 'uppercase', color: accent, marginBottom: 22,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{ width: 24, height: 1, background: accent, display: 'inline-block' }}/>
      {children}
    </div>
  );
}

// Generic code block with a fake title bar + line numbers
// Each line is either a string (raw) or an array of [color, text] tuples
function CodeCard({ title, badge, badgeColor, lines, lineNumbers = true, compact = false, maxWidth }) {
  const vp = useViewport();
  const shrink = vp.isMobile;
  const baseSize = compact ? 12 : 13;
  const fontSize = shrink ? 8.5 : baseSize;
  return (
    <div style={{
      background: COL.bgCode, border: `1px solid ${COL.line}`,
      fontFamily: 'JetBrains Mono, monospace', fontSize,
      lineHeight: 1.65, overflow: 'hidden', maxWidth,
    }}>
      {(title || badge) && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: `1px solid ${COL.line}`,
          fontSize: 11, color: COL.fgDim,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {title && <span style={{ width: 10, height: 10, background: '#4a4a4a', display: 'inline-block' }}/>}
            {title}
          </span>
          {badge && <span style={{
            fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: badgeColor,
          }}>{badge}</span>}
        </div>
      )}
      <div style={{ display: 'flex', padding: '14px 0' }}>
        {lineNumbers && (
          <div style={{
            padding: shrink ? '0 8px' : '0 12px', color: COL.fgFaint, textAlign: 'right',
            borderRight: `1px solid ${COL.line}`, userSelect: 'none', minWidth: shrink ? 28 : 36,
          }}>
            {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
          </div>
        )}
        <div style={{ padding: shrink ? '0 10px' : '0 14px', flex: 1, minWidth: 0, overflowX: shrink ? 'visible' : 'auto' }}>
          {lines.map((l, i) => (
            <div key={i} style={{
              whiteSpace: shrink ? 'pre-wrap' : 'pre',
              minHeight: fontSize * 1.65,
              overflowWrap: shrink ? 'anywhere' : 'normal',
            }}>
              {renderLine(l)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function renderLine(l) {
  if (l == null || l === '') return '\u00a0';
  if (typeof l === 'string') return l;
  // array of spans
  return l.map((s, i) => typeof s === 'string'
    ? <span key={i}>{s}</span>
    : <span key={i} style={{ color: s[0] }}>{s[1]}</span>);
}

// Syntax palette
const TK = {
  kw: '#c084fc',
  str: '#a3e635',
  fn: '#f5f5f2',
  com: COL.fgDim,
  ty: '#7dd3fc',
  prop: '#fde68a',
  num: '#fda4af',
  op: '#e4e4e7',
};

Object.assign(window, { COL, TK, Logo, Nav, SectionLabel, CodeCard, renderLine });
