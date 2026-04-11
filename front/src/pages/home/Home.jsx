import { ArrowRight, BarChart3, Calculator, Check, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'

import BrandMark from '../../components/brand/BrandMark'
import { useAuth } from '../../context/useAuth'
import './Home.css'

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

const heroProofs = [
  'Registra en segundos',
  'Proyeccion clara del proximo mes',
  'Simula antes de endeudarte',
]

const heroStats = [
  { label: 'Hoy te quedan', value: '$1.400.000', tone: 'positive' },
  { label: 'Cuotas activas', value: '$220.000', tone: 'accent' },
  { label: 'Proximo corte', value: '12 dias', tone: 'neutral' },
]

const heroBreakdown = [
  { label: 'Ingresos fijos', value: '$3.500.000', tone: 'positive' },
  { label: 'Gastos del mes', value: '$2.100.000', tone: 'negative' },
  { label: 'Extras estimados', value: '$320.000', tone: 'neutral' },
]

const heroProjectionRows = [
  { month: 'Abr', value: '$1.120.000', trend: 'up' },
  { month: 'May', value: '$980.000', trend: 'down' },
  { month: 'Jun', value: '$1.260.000', trend: 'up' },
]

const simRows = [
  { label: 'Quiero', value: 'Auto 2024' },
  { label: 'Monto', value: '$15.000.000' },
  { label: 'Banco', value: 'BCI - 8.5% anual' },
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
  const logoTarget = isLoggedIn ? '/dashboard' : '/'

  return (
    <div className="home">
      <nav className="nav">
        <div className="nav-inner">
          <Link to={logoTarget} className="nav-logo">
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
              Sabe cuanto te queda hoy
              <br />
              <span className="gradient">y como se ve tu proximo mes.</span>
            </h1>
            <p className="hero-desc">
              Aura ordena ingresos, gastos, cuotas y extras para que tomes decisiones rapidas sin planillas ni enredos.
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
            <div className="hero-proof-list">
              {heroProofs.map((item) => (
                <span key={item} className="hero-proof-chip">{item}</span>
              ))}
            </div>
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
              <div className="mockup-highlight">
                <div>
                  <div className="mockup-highlight-label">Hoy te quedan</div>
                  <div className="mockup-highlight-value">$1.400.000</div>
                  <div className="mockup-highlight-sub">Despues de fijos, cuotas y extras del mes</div>
                </div>
                <span className="mockup-highlight-badge">Saldo sano</span>
              </div>
              <div className="mockup-stat-grid">
                {heroStats.map((stat) => (
                  <div key={stat.label} className={`mockup-stat-card is-${stat.tone}`}>
                    <div className="mockup-stat-label">{stat.label}</div>
                    <div className="mockup-stat-value">{stat.value}</div>
                  </div>
                ))}
              </div>
              <div className="mockup-panel-grid">
                <div className="mockup-panel">
                  <div className="mockup-panel-title">Asi se arma tu mes</div>
                  <div className="mockup-breakdown">
                    {heroBreakdown.map((item) => (
                      <div key={item.label} className="mockup-flow-row">
                        <span>{item.label}</span>
                        <strong className={`mockup-flow-value is-${item.tone}`}>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mockup-panel">
                  <div className="mockup-panel-title">Proximo trimestre</div>
                  <div className="mockup-projection-list">
                    {heroProjectionRows.map((row) => (
                      <div key={row.month} className="mockup-projection-row">
                        <span className="mockup-projection-month">{row.month}</span>
                        <strong className={`mockup-projection-value is-${row.trend}`}>{row.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mockup-insight">
                <div className="mockup-insight-title">Antes de tomar una cuota nueva</div>
                <p className="mockup-insight-copy">
                  Simula el impacto y mira si tu flujo sigue sano sin dejarte corto al cierre del mes.
                </p>
                <div className="mockup-insight-chip-row">
                  <span className="mockup-insight-chip">Proyeccion</span>
                  <span className="mockup-insight-chip">Simulador</span>
                  <span className="mockup-insight-chip">Presupuesto</span>
                </div>
              </div>
              <div className="mockup-footer-note">
                Hecho para revisar rapido desde celular, tablet o laptop.
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
            {features.map((feature) => (
              <div key={feature.title} className="feature-card">
                <div className="feature-icon">
                  <feature.icon size={22} strokeWidth={2.2} />
                </div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-desc">{feature.desc}</p>
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
          <Link to={logoTarget} className="footer-logo">
            <BrandMark className="footer-logo-icon" />
            <span className="footer-brand">AURA - Tu plata mas clara.</span>
          </Link>
          <div className="footer-links">
            <Link to={topPrimaryTarget} className="footer-link">{topPrimaryLabel}</Link>
            <Link to={topSecondaryTarget} className="footer-link">{topSecondaryLabel}</Link>
          </div>
          <span className="footer-copy">(c) {new Date().getFullYear()} Aura</span>
        </div>
      </footer>
    </div>
  )
}
