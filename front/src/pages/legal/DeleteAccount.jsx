import { Link } from 'react-router'

import LegalShell, { LEGAL_EMAIL } from './LegalShell'

export default function DeleteAccount() {
  return (
    <LegalShell
      eyebrow="TU CUENTA, TU DECISION"
      title="Eliminar tu cuenta de Aura"
      summary="Puedes borrar tu cuenta y tus datos cuando quieras, desde la app, desde la web o por correo."
    >
      <section>
        <h2>1. Desde la app</h2>
        <p>Abre Aura y entra a <strong>☰ Más → Mi perfil → Eliminar cuenta</strong>. Escribe tu contraseña y confirma.</p>
      </section>

      <section>
        <h2>2. Desde la web</h2>
        <p>
          <Link to="/login">Inicia sesion</Link> en aura.binnso.com, entra a <strong>Perfil</strong> y usa
          {' '}<strong>Eliminar mi cuenta</strong> al final de la pagina.
        </p>
      </section>

      <section>
        <h2>3. Por correo</h2>
        <p>
          Si ya no puedes entrar, escribe a <a href={`mailto:${LEGAL_EMAIL}?subject=Eliminar%20mi%20cuenta%20de%20Aura`}>{LEGAL_EMAIL}</a>
          {' '}desde el correo con el que te registraste, con el asunto "Eliminar mi cuenta de Aura".
          La atendemos en un plazo maximo de 15 dias.
        </p>
      </section>

      <section>
        <h2>Que se elimina y que se conserva</h2>
        <ul>
          <li>Se eliminan de inmediato: tu correo, nombre de usuario, foto, contraseña, ingresos, gastos, cuotas, cuentas con personas, categorias, presupuestos, simulaciones, notificaciones y aceptaciones legales.</li>
          <li>Se conservan, sin datos que te identifiquen, los registros de pagos realizados, por obligaciones contables y tributarias.</li>
        </ul>
      </section>
    </LegalShell>
  )
}
