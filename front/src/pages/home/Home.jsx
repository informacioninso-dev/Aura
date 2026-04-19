import { ArrowRight, BarChart3, Calculator, Check, CheckCircle2, Wallet, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'

import BrandMark from '../../components/brand/BrandMark'
import { useAuth } from '../../context/useAuth'
import './Home.css'

const features = [
  {
    icon: BarChart3,
    title: 'Ves a donde va tu plata',
    desc: 'Sin Excel, sin hojas de calculo, sin adivinar. El mes se arma solo en segundos.',
  },
  {
    icon: Wallet,
    title: 'Sin sorpresas a fin de mes',
    desc: 'Cuotas, suscripciones y gastos fijos en un solo lugar. Sin abrir el banco a las 11pm a ver si alcanza.',
  },
  {
    icon: Calculator,
    title: 'Simula antes de endeudarte',
    desc: 'Prueba montos, plazos y tasas. Si el mes no aguanta la cuota, Aura te lo dice antes.',
  },
]

const heroProofs = [
  'Sin tarjeta de credito',
  'Listo en 2 minutos',
  'Funciona en celular',
]

const heroStats = [
  { label: 'Hoy te quedan', value: '$380.000', tone: 'positive' },
  { label: 'Cuotas activas', value: '$95.000', tone: 'accent' },
  { label: 'Proximo corte', value: '8 dias', tone: 'neutral' },
]

const heroBreakdown = [
  { label: 'Ingresos del mes', value: '$850.000', tone: 'positive' },
  { label: 'Gastos fijos', value: '$310.000', tone: 'negative' },
  { label: 'Cuotas y creditos', value: '$160.000', tone: 'neutral' },
]

const heroProjectionRows = [
  { month: 'May', value: '$420.000', trend: 'up' },
  { month: 'Jun', value: '$310.000', trend: 'down' },
  { month: 'Jul', value: '$490.000', trend: 'up' },
]

const pricingPlans = [
  {
    name: 'Gratis',
    desc: 'Para empezar a ordenar tus finanzas hoy.',
    price: null,
    featured: false,
    badge: null,
    features: [
      'Dashboard de ingresos y gastos',
      'Gastos a cuotas',
      'Simulador de creditos',
      'Proyeccion de 6 meses',
      'Hasta 2.000 filas por importacion',
    ],
    cta: 'Crear cuenta gratis',
    ctaStyle: 'secondary',
  },
  {
    name: 'Pro',
    desc: 'Para quien quiere ver mas lejos y decidir mejor.',
    price: '2.99',
    featured: true,
    badge: 'Mas popular',
    features: [
      'Todo lo del plan Gratis',
      'Proyeccion acumulada hasta 10 años',
      'Modos de proyeccion avanzados',
      'Historial ampliado hasta 24 meses',
      'Lo que me deben',
    ],
    cta: 'Comenzar con Pro',
    ctaStyle: 'primary',
  },
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
              Ganaste bien este mes.
              <br />
              <span className="gradient">¿Por que no te queda nada?</span>
            </h1>
            <p className="hero-desc">
              Aura te muestra en segundos a donde se fue tu plata, que viene el mes que entra y si puedes tomar esa cuota sin quedar ajustado.
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
              Sin planillas. Sin sumar a mano. Sin abrir el banco a medianoche.
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

      <section className="pricing-section">
        <div className="pricing-inner">
          <div className="section-head">
            <div className="section-label">Planes</div>
            <h2 className="section-title">Simple y sin sorpresas.</h2>
            <p className="section-desc">Empieza gratis y sube cuando necesites ver mas lejos.</p>
          </div>
          <div className="pricing-grid">
            {pricingPlans.map((plan) => (
              <div key={plan.name} className={`pricing-card${plan.featured ? ' is-featured' : ''}`}>
                {plan.badge && <div className="pricing-card-badge">{plan.badge}</div>}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    {plan.featured && <Zap size={16} color="#C487F6" />}
                    <div className="pricing-card-name">{plan.name}</div>
                  </div>
                  <div className="pricing-card-desc">{plan.desc}</div>
                </div>
                <div className="pricing-card-price">
                  {plan.price ? (
                    <>
                      <span className="pricing-price-currency">$</span>
                      <span className="pricing-price-amount">{plan.price}</span>
                      <span className="pricing-price-period">/ mes</span>
                    </>
                  ) : (
                    <span className="pricing-price-amount">Gratis</span>
                  )}
                </div>
                <ul className="pricing-features">
                  {plan.features.map((feature) => (
                    <li key={feature} className="pricing-feature">
                      <CheckCircle2 size={14} className="pricing-feature-icon" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <div className="pricing-cta">
                  <Link
                    to={isLoggedIn ? '/planes' : '/registro'}
                    className={plan.ctaStyle === 'primary' ? 'btn-primary' : 'btn-dark'}
                    style={{ width: '100%', justifyContent: 'center', display: 'flex' }}
                  >
                    {plan.cta}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

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
