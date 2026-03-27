import { Link } from 'react-router-dom'
import './Home.css'

const bars = [72, 80, 68, 88, 84, 70, 90, 82, 95, 78, 88, 100]

const features = [
  {
    emoji: '📊',
    title: 'Flujo de caja real',
    desc: 'Ve tus próximos 12 meses proyectados. Sabe exactamente cuánto te queda cada mes.',
  },
  {
    emoji: '💸',
    title: 'Control total de gastos',
    desc: 'Registra ingresos, gastos fijos, variables y cuotas. Todo categorizado y con fechas.',
  },
  {
    emoji: '🏠',
    title: 'Simulador de préstamos',
    desc: '¿Casa, auto o celular? Simula el crédito y ve si tu flujo lo aguanta antes de firmar.',
  },
]

const kpis = [
  { l: 'Ingresos',   v: '$3.500.000',  c: '#10B981' },
  { l: 'Gastos',     v: '$2.100.000',  c: '#F87171' },
  { l: 'Balance',    v: '+$1.400.000', c: '#10B981' },
  { l: 'Cuotas',     v: '$220.000',    c: '#C487F6' },
]

const simRows = [
  { label: '¿Qué quiero?',  value: 'Auto 2024' },
  { label: 'Monto',         value: '$15.000.000' },
  { label: 'Banco',         value: 'BCI · 8.5% anual' },
  { label: 'Cuota mensual', value: '$681.000' },
  { label: 'Plazo',         value: '24 meses' },
]

export default function Home() {
  return (
    <div className="home">

      {/* ── NAVBAR ── */}
      <nav className="nav">
        <div className="nav-inner">
          <Link to="/" className="nav-logo">
            <div className="nav-logo-icon">A</div>
            <div className="nav-logo-text">
              <div className="nav-logo-name">AURA</div>
              <div className="nav-logo-tag">Clara Proyección, Futuro Sólido.</div>
            </div>
          </Link>
          <div className="nav-links">
            <Link to="/login" className="btn-ghost">Ingresar</Link>
            <Link to="/registro" className="btn-dark">Crear cuenta gratis</Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div className="hero-wrap">
        <div className="hero">
          <div>
            <div className="hero-badge">
              <span className="hero-badge-dot" />
              100% gratis · Sin tarjeta de crédito
            </div>
            <h1>
              Deja de adivinar
              <br />
              <span className="gradient">cuánto te queda.</span>
            </h1>
            <p className="hero-desc">
              Aura organiza tus ingresos, gastos y cuotas para que sepas exactamente en qué
              estás — y a dónde vas. Todo en tiempo real.
            </p>
            <div className="hero-actions">
              <Link to="/registro" className="btn-primary">
                Empezar gratis →
              </Link>
              <Link to="/login" className="btn-secondary-link">
                Ya tengo cuenta
              </Link>
            </div>
          </div>

          {/* Dashboard mockup */}
          <div className="mockup">
            <div className="mockup-bar">
              <div className="dot dot-r" />
              <div className="dot dot-y" />
              <div className="dot dot-g" />
              <div className="mockup-url">
                <span>app.aura.cl/dashboard</span>
              </div>
            </div>
            <div className="mockup-body">
              <div className="kpi-row">
                {kpis.map(s => (
                  <div key={s.l} className="kpi-card">
                    <div className="kpi-label">{s.l}</div>
                    <div className="kpi-value" style={{ color: s.c }}>{s.v}</div>
                  </div>
                ))}
              </div>
              <div className="chart-card">
                <div className="chart-title">Flujo de caja — 12 meses</div>
                <div className="chart-bars">
                  {bars.map((h, i) => (
                    <div key={i} className="bar-col">
                      <div className="bar-inc" style={{ height: `${h}%`, background: 'linear-gradient(to top, #10B981, #34D399)' }} />
                      <div className="bar-gas" style={{ height: `${h * 0.55}%`, background: 'rgba(248,113,113,0.6)' }} />
                    </div>
                  ))}
                </div>
                <div className="chart-legend">
                  <div className="legend-item"><div className="legend-dot" style={{ background: '#10B981' }} /><span>Ingresos</span></div>
                  <div className="legend-item"><div className="legend-dot" style={{ background: '#F87171' }} /><span>Gastos</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── FEATURES ── */}
      <section>
        <div className="section">
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div className="section-label">Qué hace Aura</div>
            <h2 className="section-title">Tu plata, bajo control total.</h2>
            <p className="section-desc" style={{ margin: '0 auto', textAlign: 'center' }}>
              No es solo un registro. Aura te proyecta el futuro para que no te agarre por sorpresa.
            </p>
          </div>
          <div className="features-grid">
            {features.map(({ emoji, title, desc }) => (
              <div key={title} className="feature-card">
                <div className="feature-icon">{emoji}</div>
                <h3 className="feature-title">{title}</h3>
                <p className="feature-desc">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SIMULATOR STRIP ── */}
      <div className="sim-strip">
        <div className="sim-inner">
          <div>
            <div className="sim-badge">✦ Simulador de préstamos</div>
            <h2 className="sim-title">
              ¿Me alcanza para<br />comprarlo en cuotas?
            </h2>
            <p className="sim-desc">
              Ingresa el monto, elige el banco y Aura te dice al tiro si tu flujo de caja lo aguanta.
              Sin Excel. Sin suposiciones.
            </p>
            <Link to="/registro" className="btn-lila">
              Probarlo gratis →
            </Link>
          </div>

          <div className="sim-card">
            {simRows.map(({ label, value }) => (
              <div key={label} className="sim-row">
                <span className="sim-row-label">{label}</span>
                <span className="sim-row-value">{value}</span>
              </div>
            ))}
            <div className="sim-result">
              <div className="sim-result-icon">✓</div>
              <div>
                <div className="sim-result-text">¡Es factible!</div>
                <div className="sim-result-sub">Tu flujo de caja lo aguanta en todos los meses</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── CTA FINAL ── */}
      <div className="cta-section">
        <div className="cta-box">
          <div className="cta-logo">A</div>
          <h2 className="cta-title">Dale, es gratis.</h2>
          <p className="cta-desc">
            Sin tarjeta. Sin letra chica. Solo tú y tu plata, finalmente organizados.
          </p>
          <Link to="/registro" className="btn-primary" style={{ fontSize: 16, padding: '15px 36px' }}>
            Crear mi cuenta gratis →
          </Link>
          <p className="cta-sub">
            ¿Ya tienes cuenta?{' '}
            <Link to="/login" style={{ color: '#C487F6', textDecoration: 'none', fontWeight: 600 }}>
              Inicia sesión aquí
            </Link>
          </p>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer className="footer">
        <div className="footer-inner">
          <Link to="/" className="footer-logo">
            <div className="footer-logo-icon">A</div>
            <span className="footer-brand">AURA — Clara Proyección, Futuro Sólido.</span>
          </Link>
          <div className="footer-links">
            <Link to="/login" className="footer-link">Ingresar</Link>
            <Link to="/registro" className="footer-link">Registrarse</Link>
          </div>
          <span className="footer-copy">© {new Date().getFullYear()} Aura</span>
        </div>
      </footer>

    </div>
  )
}
