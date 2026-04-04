import { ArrowRight, BarChart3, Calculator, Check, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'

import BrandMark from '../../components/brand/BrandMark'
import { useAuth } from '../../context/useAuth'
import './Home.css'

const bars = [72, 80, 68, 88, 84, 70, 90, 82, 95, 78, 88, 100]

const features = [
  {
    icon: BarChart3,
    title: 'Flujo claro',
    desc: 'Ve lo que ganas, tus gastos y lo que queda sin sacar Excel.',
  },
  {
    icon: Wallet,
    title: 'Todo en orden',
    desc: 'Registra ingresos, gastos y compras a cuotas en segundos.',
  },
  {
    icon: Calculator,
    title: 'Simula antes',
    desc: 'Prueba una cuota y mira si tu mes la aguanta.',
  },
]

const kpis = [
  { l: 'Ingresos', v: '$3.500.000', c: '#10B981' },
  { l: 'Gastos', v: '$2.100.000', c: '#F87171' },
  { l: 'Balance', v: '+$1.400.000', c: '#10B981' },
  { l: 'A cuotas', v: '$220.000', c: '#C487F6' },
]

const simRows = [
  { label: 'Quiero', value: 'Auto 2024' },
  { label: 'Monto', value: '$15.000.000' },
  { label: 'Banco', value: 'BCI · 8.5% anual' },
  { label: 'Cuota', value: '$681.000' },
  { label: 'Plazo', value: '24 meses' },
]

export default function Home() {
  const { user } = useAuth()
  const isLoggedIn = Boolean(user)
  const topPrimaryTarget = isLoggedIn ? '/dashboard' : '/login'
  const topPrimaryLabel = isLoggedIn ? 'Mi dinero' : 'Ingresar'
  const topSecondaryTarget = isLoggedIn ? '/perfil' : '/registro'
  const topSecondaryLabel = isLoggedIn ? 'Mi perfil' : 'Crear cuenta'
  const heroPrimaryTarget = isLoggedIn ? '/dashboard' : '/registro'
  const heroPrimaryLabel = isLoggedIn ? 'Ir a mi dashboard' : 'Crear cuenta'
  const heroSecondaryTarget = isLoggedIn ? '/simulador' : '/login'
  const heroSecondaryLabel = isLoggedIn ? 'Abrir simulador' : 'Ya tengo cuenta'
  const simulatorCtaTarget = isLoggedIn ? '/simulador' : '/registro'
  const simulatorCtaLabel = isLoggedIn ? 'Abrir simulador' : 'Simular gratis'
  const footerPrimaryTarget = isLoggedIn ? '/dashboard' : '/registro'
  const footerPrimaryLabel = isLoggedIn ? 'Volver a mi dashboard' : 'Crear cuenta'
  const footerSecondaryTarget = isLoggedIn ? '/perfil' : '/login'
  const footerSecondaryLabel = isLoggedIn ? 'Ir a mi perfil' : 'Inicia sesion'

  return (
    <div className="home">
      <nav className="nav">
        <div className="nav-inner">
          <Link to="/" className="nav-logo">
            <BrandMark className="nav-logo-icon" />
            <div className="nav-logo-text">
              <div className="nav-logo-name">AURA</div>
              <div className="nav-logo-tag">Tu plata mas clara.</div>
            </div>
          </Link>
          <div className="nav-links">
            <Link to={topPrimaryTarget} className="btn-ghost">{topPrimaryLabel}</Link>
            <Link to={topSecondaryTarget} className="btn-dark">{topSecondaryLabel}</Link>
          </div>
        </div>
      </nav>

      <div className="hero-wrap">
        <div className="hero">
          <div className="hero-copy">
            <div className="hero-badge">
              <span className="hero-badge-dot" />
              Gratis y sin tarjeta
            </div>
            <h1>
              Tu plata,
              <br />
              <span className="gradient">clara al instante.</span>
            </h1>
            <p className="hero-desc">
              Aura te muestra cuanto te queda hoy y como se ve tu proximo mes.
              Sin planillas. Sin vueltas.
            </p>
            <div className="hero-actions">
              <Link to={heroPrimaryTarget} className="btn-primary">
                {heroPrimaryLabel} <ArrowRight size={16} />
              </Link>
              <Link to={heroSecondaryTarget} className="btn-secondary-link">
                {heroSecondaryLabel}
              </Link>
            </div>
            <p className="hero-note">
              Gastos, pagos a cuotas y flujo de caja en un solo lugar.
            </p>
          </div>

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
                {kpis.map((stat) => (
                  <div key={stat.l} className="kpi-card">
                    <div className="kpi-label">{stat.l}</div>
                    <div className="kpi-value" style={{ color: stat.c }}>{stat.v}</div>
                  </div>
                ))}
              </div>
              <div className="chart-card">
                <div className="chart-title">Tu flujo en 12 meses</div>
                <div className="chart-bars">
                  {bars.map((height, index) => (
                    <div key={index} className="bar-col">
                      <div
                        className="bar-inc"
                        style={{
                          height: `${height}%`,
                          background: 'linear-gradient(to top, #10B981, #34D399)',
                        }}
                      />
                      <div
                        className="bar-gas"
                        style={{
                          height: `${height * 0.55}%`,
                          background: 'rgba(248,113,113,0.6)',
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="chart-legend">
                  <div className="legend-item">
                    <div className="legend-dot" style={{ background: '#10B981' }} />
                    <span>Ingresos</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-dot" style={{ background: '#F87171' }} />
                    <span>Gastos</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section>
        <div className="section">
          <div className="section-head">
            <div className="section-label">Lo resuelve rapido</div>
            <h2 className="section-title">Menos vueltas. Mas claridad.</h2>
            <p className="section-desc">
              Lo importante aparece primero para que decidas rapido.
            </p>
          </div>
          <div className="features-grid">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="feature-card">
                <div className="feature-icon">
                  <Icon size={22} strokeWidth={2.2} />
                </div>
                <h3 className="feature-title">{title}</h3>
                <p className="feature-desc">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="sim-strip">
        <div className="sim-inner">
          <div>
            <div className="sim-badge">Prestamos</div>
            <h2 className="sim-title">Si un pago a cuotas te ahoga, lo ves antes.</h2>
            <p className="sim-desc">
              Prueba montos, tasas y plazos antes de comprometerte.
            </p>
            <Link to={simulatorCtaTarget} className="btn-lila">
              {simulatorCtaLabel} <ArrowRight size={16} />
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
              <div className="sim-result-icon">
                <Check size={16} strokeWidth={3} />
              </div>
              <div>
                <div className="sim-result-text">Si te da</div>
                <div className="sim-result-sub">
                  Tu flujo sigue positivo cada mes.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="cta-section">
        <div className="cta-box">
          <BrandMark className="cta-logo" />
          <h2 className="cta-title">Empieza en minutos.</h2>
          <p className="cta-desc">
            Crea tu cuenta y entiende tu panorama sin enredarte.
          </p>
          <Link
            to={footerPrimaryTarget}
            className="btn-primary"
            style={{ fontSize: 16, padding: '15px 32px' }}
          >
            {footerPrimaryLabel} <ArrowRight size={16} />
          </Link>
          <p className="cta-sub">
            {isLoggedIn ? 'Acceso rapido:' : 'Ya tienes cuenta?'}{' '}
            <Link
              to={footerSecondaryTarget}
              style={{ color: '#C487F6', textDecoration: 'none', fontWeight: 600 }}
            >
              {footerSecondaryLabel}
            </Link>
          </p>
        </div>
      </div>

      <footer className="footer">
        <div className="footer-inner">
          <Link to="/" className="footer-logo">
            <BrandMark className="footer-logo-icon" />
            <span className="footer-brand">AURA - Tu plata mas clara.</span>
          </Link>
          <div className="footer-links">
            <Link to={topPrimaryTarget} className="footer-link">{topPrimaryLabel}</Link>
            <Link to={topSecondaryTarget} className="footer-link">{topSecondaryLabel}</Link>
          </div>
          <span className="footer-copy">© {new Date().getFullYear()} Aura</span>
        </div>
      </footer>
    </div>
  )
}
