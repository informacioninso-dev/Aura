import { Link } from 'react-router'

import LegalShell, { LEGAL_EMAIL, LEGAL_OPERATOR } from './LegalShell'

export default function PrivacyNotice() {
  return (
    <LegalShell
      eyebrow="TU INFORMACIÓN, SIN LETRA PEQUEÑA"
      title="Aviso de Privacidad"
      summary="Aquí explicamos qué datos usa Aura, para qué los necesita y cómo puedes ejercer control sobre ellos."
    >
      <section>
        <h2>1. Responsable y alcance</h2>
        <p>
          {LEGAL_OPERATOR}, como operador de Aura en aura.binnso.com, trata los datos personales
          necesarios para prestar la aplicación. Puedes escribir a <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a> para
          consultas o para ejercer tus derechos.
        </p>
      </section>

      <section>
        <h2>2. Datos que tratamos</h2>
        <ul>
          <li>Datos de cuenta: nombre de usuario, correo, moneda, credenciales protegidas y foto opcional.</li>
          <li>Datos financieros que ingresas: ingresos, gastos, deudas, cuotas, saldos, categorías y simulaciones.</li>
          <li>Datos técnicos y de seguridad: dirección IP, dispositivo, navegador, fechas de acceso y registros de actividad.</li>
          <li>Datos de pago y suscripción recibidos de PayPhone. Aura no almacena el número completo de tu tarjeta.</li>
          <li>Texto o audio que decides enviar al asistente para interpretar un registro financiero.</li>
        </ul>
      </section>

      <section>
        <h2>3. Para qué usamos tus datos</h2>
        <ul>
          <li>Crear y proteger tu cuenta, autenticarte y prestarte las funciones de Aura.</li>
          <li>Calcular balances, proyecciones y simulaciones a partir de la información que registras.</li>
          <li>Gestionar planes, pagos, soporte, notificaciones y solicitudes.</li>
          <li>Prevenir abuso, investigar incidentes y cumplir obligaciones legales.</li>
          <li>Procesar texto o audio con el proveedor de IA solo cuando activas voluntariamente esa función.</li>
        </ul>
        <p>
          El tratamiento central se basa en la ejecución del servicio que solicitas. Las obligaciones
          legales, la seguridad y las funciones opcionales pueden apoyarse en otras bases permitidas
          por la ley, incluido el consentimiento cuando sea necesario. No vendemos tus datos.
        </p>
      </section>

      <section>
        <h2>4. Proveedores y transferencias</h2>
        <p>
          Podemos usar proveedores de infraestructura, correo, seguridad y soporte. PayPhone procesa
          pagos; Groq procesa el texto o audio que envías al asistente. Algunos proveedores pueden
          tratar datos fuera de Ecuador. En esos casos se deben aplicar las garantías contractuales,
          técnicas y legales exigibles para transferencias de datos.
        </p>
      </section>

      <section>
        <h2>5. Conservación y seguridad</h2>
        <p>
          Conservamos los datos mientras tu cuenta esté activa y durante los plazos necesarios para
          obligaciones legales, reclamos, seguridad y registros de transacciones. Luego se eliminan
          o anonimizan cuando corresponde. Aplicamos controles de acceso, cifrado en tránsito,
          separación por usuario y monitoreo; ningún sistema puede prometer riesgo cero.
        </p>
      </section>

      <section>
        <h2>6. Tus derechos</h2>
        <p>
          Puedes solicitar información, acceso, rectificación, actualización, eliminación, oposición,
          portabilidad, suspensión del tratamiento y revocación del consentimiento cuando aplique.
          También puedes pedir explicaciones sobre tratamientos automatizados y presentar un reclamo
          ante la <a href="https://spdp.gob.ec/" target="_blank" rel="noreferrer">Superintendencia de Protección de Datos Personales</a>.
        </p>
        <p>
          Envía tu solicitud a <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>. Podremos verificar tu identidad
          antes de entregar o modificar información.
        </p>
        <p>
          Puedes eliminar tu cuenta y tus datos en cualquier momento desde la app o la web.
          Los pasos están en <Link to="/eliminar-cuenta">Eliminar tu cuenta</Link>.
        </p>
      </section>

      <section>
        <h2>7. Cálculos automatizados y cambios</h2>
        <p>
          Las proyecciones y simulaciones son cálculos informativos basados en tus datos; Aura no toma
          decisiones crediticias ni ejecuta operaciones financieras por ti. Si este aviso cambia de
          forma material, se informará la nueva versión y se solicitará una nueva confirmación cuando
          la normativa lo requiera.
        </p>
      </section>
    </LegalShell>
  )
}