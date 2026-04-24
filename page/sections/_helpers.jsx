function CmdBox({ accent, cmd, slash, comment }) {
  const vp = useViewport();
  const wrap = vp.isMobile;
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
      fontFamily: 'JetBrains Mono, monospace', fontSize: wrap ? 9.5 : 12.5,
      color: COL.fg, alignSelf: 'start', position: 'relative',
      display: 'flex', alignItems: 'flex-start',
    }}>
      <div style={{
        flex: 1, padding: '14px 16px', minWidth: 0,
        whiteSpace: wrap ? 'pre-wrap' : 'pre',
        overflowX: wrap ? 'visible' : 'auto',
        wordBreak: wrap ? 'break-all' : 'normal',
        textIndent: wrap ? '-1.4em' : 0,
        paddingLeft: wrap ? '2.6em' : '16px',
      }}>
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


const codeInline = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '0.88em',
  color: '#f5f5f2',
  background: 'rgba(255,255,255,0.05)',
  padding: '1px 6px',
  borderRadius: 0,
};

Object.assign(window, { CmdBox, codeInline });
