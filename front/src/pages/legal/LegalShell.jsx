import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'

import BrandMark from '../../components/brand/BrandMark'
import './legal.css'

export const LEGAL_VERSION = '2026-07-26'
export const LEGAL_DATE = '26 de julio de 2026'
export const LEGAL_OPERATOR = 'Binnso'
export const LEGAL_EMAIL = 'info@binnso.com'

export default function LegalShell({ eyebrow, title, summary, children }) {
  return (
    <main className="legal-page">
      <header className="legal-nav">
        <Link to="/" className="legal-brand" aria-label="Volver al inicio de Aura">
          <BrandMark className="legal-brand-mark" />
          <span><strong>AURA</strong><small>Tu plata mas clara</small></span>
        </Link>
        <Link to="/registro" className="legal-back"><ArrowLeft size={15} /> Volver al registro</Link>
      </header>

      <article className="legal-document">
        <div className="legal-heading">
          <span>{eyebrow}</span>
          <h1>{title}</h1>
          <p>{summary}</p>
          <div className="legal-version">Version {LEGAL_VERSION} | Vigente desde {LEGAL_DATE}</div>
        </div>
        <div className="legal-content">{children}</div>
      </article>

      <footer className="legal-footer">
        <span>{LEGAL_OPERATOR} | {LEGAL_EMAIL}</span>
        <span><Link to="/privacidad">Privacidad</Link><Link to="/terminos">Terminos</Link></span>
      </footer>
    </main>
  )
}