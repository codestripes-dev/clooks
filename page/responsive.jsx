// Responsive system — simulated viewport + useViewport hook
// ------------------------------------------------------------
// The site can be rendered at its real viewport width, or "simulated" at a
// fixed width (Desktop / Tablet / Mobile) via the Tweaks panel. Components
// read the effective width from context and choose layouts accordingly.

const VIEWPORT_PRESETS = {
  full:    { label: 'Full',       width: null, device: false },
  desktop: { label: 'Desktop',    width: 1280, device: true  },
  tablet:  { label: 'Tablet',     width: 820,  device: true  },
  mobile:  { label: 'Mobile',     width: 390,  device: true  },
};

const BP = {
  mobile: 640,    // below this = mobile
  tablet: 960,    // below this = tablet
  // else desktop
};

const ViewportCtx = React.createContext({
  width: 1280,
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  device: false,
});

function useViewport() {
  return React.useContext(ViewportCtx);
}

function useWindowWidth() {
  const [w, setW] = React.useState(() => typeof window !== 'undefined' ? window.innerWidth : 1280);
  React.useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

// ViewportFrame — either renders children full-bleed (sim = 'full'),
// or inside a centered device-like frame at a fixed width.
function ViewportFrame({ sim, children }) {
  const preset = VIEWPORT_PRESETS[sim] || VIEWPORT_PRESETS.full;
  const winW = useWindowWidth();
  const effective = preset.width ?? winW;

  const ctxValue = React.useMemo(() => ({
    width: effective,
    isMobile: effective < BP.mobile,
    isTablet: effective >= BP.mobile && effective < BP.tablet,
    isDesktop: effective >= BP.tablet,
    device: preset.device,
  }), [effective, preset.device]);

  if (!preset.device) {
    return <ViewportCtx.Provider value={ctxValue}>{children}</ViewportCtx.Provider>;
  }

  // Device-simulation: center a fixed-width column in a neutral chrome,
  // with a label at top showing the simulated dimensions.
  return (
    <ViewportCtx.Provider value={ctxValue}>
      <div style={{
        minHeight: '100vh', background: '#050505',
        padding: '44px 24px 80px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <div style={{
          width: preset.width, maxWidth: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 14, fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.35)',
        }}>
          <span>{preset.label}</span>
          <span>{preset.width}px</span>
        </div>
        <div style={{
          width: preset.width, maxWidth: '100%',
          background: '#0a0a0a',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>
          {children}
        </div>
      </div>
    </ViewportCtx.Provider>
  );
}

// Helper to pick a value by breakpoint
function bp(vp, { mobile, tablet, desktop }) {
  if (vp.isMobile && mobile !== undefined) return mobile;
  if (vp.isTablet && tablet !== undefined) return tablet;
  return desktop;
}

Object.assign(window, {
  VIEWPORT_PRESETS, BP, ViewportCtx, useViewport, ViewportFrame, bp,
});
