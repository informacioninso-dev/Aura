import {
  ArrowRight,
  BarChart3,
  Calculator,
  CalendarRange,
  Check,
  CheckCircle2,
  Wallet,
  Zap,
} from 'lucide-react'
import { Link } from 'react-router'

import BrandMark from '../../components/brand/BrandMark'
import { useAuth } from '../../context/useAuth'
import './Home.css'

const valueRows = [
  {
    icon: Wallet,
    step: '01 / AHORA',
    title: 'Cuanto me queda de verdad?',
    desc: 'Aura descuenta fijos, variables, cuotas y compromisos para mostrar el dinero realmente disponible.',
    tone: 'green',
  },
  {
    icon: BarChart3,
    step: '02 / DESPUES',
    title: 'Como vienen mis proximos meses?',
    desc: 'La proyeccion convierte tu historial en una ruta clara, no en otra lista de movimientos pasados.',
    tone: 'lila',
  },
  {
    icon: Calculator,
    step: '03 / ANTES DE DECIDIR',
    title: 'Que pasa si hago este gasto?',
    desc: 'Simula una compra, un prestamo o un gasto de vida y compara tu saldo futuro antes de comprometerte.',
    tone: 'coral',
  },
]

const pricingPlans = [
  {
    name: 'Gratis',
    number: '01',
    desc: 'Para ordenar el mes y probar decisiones sin pagar.',
    price: 'Gratis',
    period: '',
    featured: false,
    features: [
      'Dashboard de ingresos y gastos',
      'Gastos a cuotas y simulador',
      'Proyeccion de 6 meses',
    ],
    cta: 'Crear cuenta gratis',
  },
  {
    name: 'Pro',
    number: '02',
    desc: 'Para ver mas lejos y proyectar con mas contexto.',
    price: '$2.99',
    period: '/ mes',
    featured: true,
    features: [
      'Proyeccion acumulada hasta 10 anos',
      'Modos inteligente y conservador',
      'Historial ampliado y cuentas con personas',
    ],
    cta: 'Elegir Pro',
  },
]

export default function Home() {
  const { user } = useAuth()
  const isLoggedIn = Boolean(user)
  const primaryTarget = isLoggedIn ? '/dashboard' : '/registro'
  const primaryLabel = isLoggedIn ? 'Ir a mi dinero' : 'Crear cuenta gratis'
  const accountTarget = isLoggedIn ? '/perfil' : '/login'
  const accountLabel = isLoggedIn ? 'Mi perfil' : 'Ingresar'
  const simulatorTarget = isLoggedIn ? '/simulador' : '/registro'
  const logoTarget = isLoggedIn ? '/dashboard' : '/'

  return (
    <div className="home">
      <nav className="home-nav" aria-label="Principal">
        <div className="home-nav-inner">
          <Link to={logoTarget} className="home-brand">
            <BrandMark className="home-brand-mark" />
            <span className="home-brand-copy">
              <strong>AURA</strong>
              <small>Tu plata mas clara</small>
            </span>
          </Link>

          <div className="home-nav-jumps" aria-label="Contenido de la pagina">
            <a href="#como-funciona">Como funciona</a>
            <a href="#planes">Planes</a>
          </div>

          <div className="home-nav-actions">
            <Link to={accountTarget} className="home-btn-quiet">{accountLabel}</Link>
            <Link to={primaryTarget} className="home-btn-nav">
              {isLoggedIn ? 'Abrir Aura' : 'Crear cuenta'}
            </Link>
          </div>
        </div>
      </nav>

      <main>
        <section className="home-hero-wrap">
          <div className="home-hero">
            <div className="home-hero-copy">
              <div className="home-eyebrow">
                <span />
                Tus finanzas, sin adivinar
              </div>
              <h1>
                Antes de gastar,
                <em> mira si te alcanza.</em>
              </h1>
              <p className="home-hero-desc">
                Aura organiza ingresos, gastos, cuotas y planes futuros para mostrarte cuanto te queda hoy y como cambia tu dinero si tomas esa decision.
              </p>

              <div className="home-hero-actions">
                <Link to={primaryTarget} className="home-btn-primary">
                  {primaryLabel} <ArrowRight size={17} />
                </Link>
                <a href="#como-funciona" className="home-btn-text">
                  Ver como funciona
                </a>
              </div>

              <div className="home-proof-line" aria-label="Beneficios de registro">
                <span><Check size={14} /> Sin tarjeta</span>
                <span><Check size={14} /> Listo en 2 minutos</span>
                <span><Check size={14} /> Hecho para celular</span>
              </div>
            </div>

            <div className="home-money-window" aria-label="Ejemplo del panorama financiero en Aura">
              <div className="home-money-head">
                <div>
                  <span className="home-money-kicker">RADAR DE TU DINERO</span>
                  <strong>Julio 2026</strong>
                </div>
                <span className="home-live"><i /> Actualizado</span>
              </div>

              <div className="home-balance">
                <div>
                  <span>Saldo disponible proyectado</span>
                  <strong>$245.00</strong>
                  <small>Despues de cubrir gastos y cuotas del mes</small>
                </div>
                <span className="home-health">Saludable</span>
              </div>

              <div className="home-chart-head">
                <div>
                  <span className="home-chart-dot is-green" />
                  Sin hacer la compra
                </div>
                <div>
                  <span className="home-chart-dot is-lila" />
                  Incluyendo la compra
                </div>
              </div>

              <div className="home-chart" aria-hidden="true">
                <svg viewBox="0 0 520 150" preserveAspectRatio="none">
                  <path className="home-chart-grid" d="M0 25H520M0 75H520M0 125H520M104 0V150M208 0V150M312 0V150M416 0V150" />
                  <path className="home-chart-area" d="M0 121 C75 109 118 88 175 77 S290 58 350 38 S450 22 520 8 V150 H0 Z" />
                  <path className="home-chart-line is-base" d="M0 121 C75 109 118 88 175 77 S290 58 350 38 S450 22 520 8" />
                  <path className="home-chart-line is-decision" d="M0 121 C75 115 118 108 175 105 S290 95 350 86 S450 81 520 70" />
                  <circle className="home-chart-point" cx="175" cy="105" r="4" />
                </svg>
                <span className="home-chart-label is-first">HOY</span>
                <span className="home-chart-label is-last">12 MESES</span>
              </div>

              <div className="home-decision">
                <div className="home-decision-icon"><CalendarRange size={18} /></div>
                <div>
                  <span>Si haces una compra de $360.00 en 6 cuotas</span>
                  <strong>Tu saldo sigue positivo, pero septiembre queda ajustado.</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="home-story-rail" aria-label="Lo que Aura muestra">
            <div><span>01</span><strong>Lo que tienes hoy</strong></div>
            <div><span>02</span><strong>Lo que viene despues</strong></div>
            <div><span>03</span><strong>El costo real de decidir</strong></div>
          </div>
        </section>

        <section id="como-funciona" className="home-value-section">
          <div className="home-section-heading">
            <div>
              <span className="home-section-label">NO ES OTRO REGISTRO DE GASTOS</span>
              <h2>Las tres respuestas que necesitas antes de mover tu dinero.</h2>
            </div>
            <p>
              Lo importante no es llenar cuadros. Es entender rapido que puedes hacer con tu dinero.
            </p>
          </div>

          <div className="home-value-layout">
            <div className="home-value-list">
              {valueRows.map((item) => (
                <article key={item.title} className={`home-value-row is-${item.tone}`}>
                  <div className="home-value-icon"><item.icon size={21} /></div>
                  <div>
                    <span>{item.step}</span>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </div>
                  <ArrowRight className="home-value-arrow" size={18} />
                </article>
              ))}
            </div>

            <aside className="home-simulator-sheet">
              <div className="home-sheet-head">
                <span>SIMULACION / COMPRA GRANDE</span>
                <strong>Puede mi plata con esto?</strong>
              </div>
              <div className="home-sheet-choice">
                <span>Decision</span>
                <strong>Computadora para trabajar</strong>
                <small>$900.00 a 12 meses</small>
              </div>
              <dl className="home-sheet-numbers">
                <div>
                  <dt>Sin la compra</dt>
                  <dd>$245.00</dd>
                </div>
                <div>
                  <dt>Con la compra</dt>
                  <dd>$160.00</dd>
                </div>
                <div>
                  <dt>Cuota estimada</dt>
                  <dd>-$85.00</dd>
                </div>
              </dl>
              <div className="home-sheet-verdict">
                <Check size={16} />
                <div>
                  <strong>Cabe, con margen ajustado</strong>
                  <span>Mantienes saldo positivo durante los 12 meses.</span>
                </div>
              </div>
              <Link to={simulatorTarget} className="home-sheet-link">
                Probar una decision <ArrowRight size={16} />
              </Link>
            </aside>
          </div>
        </section>

        <section id="planes" className="home-pricing-section">
          <div className="home-pricing-inner">
            <div className="home-section-heading is-pricing">
              <div>
                <span className="home-section-label">EMPIEZA SIN COMPROMETERTE</span>
                <h2>Primero entiende tu mes. Luego decide si necesitas mas.</h2>
              </div>
              <p>El plan gratis ya te deja ordenar, proyectar y simular. Pro abre una mirada mas larga.</p>
            </div>

            <div className="home-plan-list">
              {pricingPlans.map((plan) => (
                <article key={plan.name} className={`home-plan-row${plan.featured ? ' is-featured' : ''}`}>
                  <span className="home-plan-number">{plan.number}</span>
                  <div className="home-plan-name">
                    <div>
                      {plan.featured && <Zap size={15} />}
                      <h3>{plan.name}</h3>
                    </div>
                    <p>{plan.desc}</p>
                  </div>
                  <div className="home-plan-price">
                    <strong>{plan.price}</strong>
                    {plan.period && <span>{plan.period}</span>}
                  </div>
                  <ul>
                    {plan.features.map((feature) => (
                      <li key={feature}><CheckCircle2 size={14} /> {feature}</li>
                    ))}
                  </ul>
                  <Link to={isLoggedIn ? '/planes' : '/registro'} className={plan.featured ? 'home-plan-cta is-featured' : 'home-plan-cta'}>
                    {plan.cta} <ArrowRight size={15} />
                  </Link>
                </article>
              ))}
            </div>

            <div className="home-closing">
              <div>
                <BrandMark className="home-closing-mark" />
                <div>
                  <span>Tu plata mas clara, desde hoy.</span>
                  <strong>Abre Aura y arma tu primer mes en minutos.</strong>
                </div>
              </div>
              <Link to={primaryTarget} className="home-btn-primary">
                {primaryLabel} <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-footer-inner">
          <Link to={logoTarget} className="home-brand is-footer">
            <BrandMark className="home-brand-mark" />
            <span className="home-brand-copy"><strong>AURA</strong></span>
          </Link>
          <span>Aura no reemplaza asesoria financiera profesional.</span>
          <span className="home-footer-legal">
            <Link to="/privacidad">Privacidad</Link>
            <Link to="/terminos">Terminos</Link>
          </span>
          <span>(c) {new Date().getFullYear()} Aura</span>
        </div>
      </footer>
    </div>
  )
}