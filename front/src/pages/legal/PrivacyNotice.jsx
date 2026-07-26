import LegalShell, { LEGAL_EMAIL, LEGAL_OPERATOR } from './LegalShell'

export default function PrivacyNotice() {
  return (
    <LegalShell
      eyebrow="TU INFORMACION, SIN LETRA PEQUENA"
      title="Aviso de Privacidad"
      summary="Aqui explicamos que datos usa Aura, para que los necesita y como puedes ejercer control sobre ellos."
    >
      <section>
        <h2>1. Responsable y alcance</h2>
        <p>
          {LEGAL_OPERATOR}, como operador de Aura en aura.binnso.com, trata los datos personales
          necesarios para prestar la aplicacion. Puedes escribir a <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a> para
          consultas o para ejercer tus derechos.
        </p>
      </section>

      <section>
        <h2>2. Datos que tratamos</h2>
        <ul>
          <li>Datos de cuenta: nombre de usuario, correo, moneda, credenciales protegidas y foto opcional.</li>
          <li>Datos financieros que ingresas: ingresos, gastos, deudas, cuotas, saldos, categorias y simulaciones.</li>
          <li>Datos tecnicos y de seguridad: direccion IP, dispositivo, navegador, fechas de acceso y registros de actividad.</li>
          <li>Datos de pago y suscripcion recibidos de PayPhone. Aura no almacena el numero completo de tu tarjeta.</li>
          <li>Texto o audio que decides enviar al asistente para interpretar un registro financiero.</li>
        </ul>
      </section>

      <section>
        <h2>3. Para que usamos tus datos</h2>
        <ul>
          <li>Crear y proteger tu cuenta, autenticarte y prestarte las funciones de Aura.</li>
          <li>Calcular balances, proyecciones y simulaciones a partir de la informacion que registras.</li>
          <li>Gestionar planes, pagos, soporte, notificaciones y solicitudes.</li>
          <li>Prevenir abuso, investigar incidentes y cumplir obligaciones legales.</li>
          <li>Procesar texto o audio con el proveedor de IA solo cuando activas voluntariamente esa funcion.</li>
        </ul>
        <p>
          El tratamiento central se basa en la ejecucion del servicio que solicitas. Las obligaciones
          legales, la seguridad y las funciones opcionales pueden apoyarse en otras bases permitidas
          por la ley, incluido el consentimiento cuando sea necesario. No vendemos tus datos.
        </p>
      </section>

      <section>
        <h2>4. Proveedores y transferencias</h2>
        <p>
          Podemos usar proveedores de infraestructura, correo, seguridad y soporte. PayPhone procesa
          pagos; Groq procesa el texto o audio que envias al asistente. Algunos proveedores pueden
          tratar datos fuera de Ecuador. En esos casos se deben aplicar las garantias contractuales,
          tecnicas y legales exigibles para transferencias de datos.
        </p>
      </section>

      <section>
        <h2>5. Conservacion y seguridad</h2>
        <p>
          Conservamos los datos mientras tu cuenta este activa y durante los plazos necesarios para
          obligaciones legales, reclamos, seguridad y registros de transacciones. Luego se eliminan
          o anonimizan cuando corresponde. Aplicamos controles de acceso, cifrado en transito,
          separacion por usuario y monitoreo; ningun sistema puede prometer riesgo cero.
        </p>
      </section>

      <section>
        <h2>6. Tus derechos</h2>
        <p>
          Puedes solicitar informacion, acceso, rectificacion, actualizacion, eliminacion, oposicion,
          portabilidad, suspension del tratamiento y revocacion del consentimiento cuando aplique.
          Tambien puedes pedir explicaciones sobre tratamientos automatizados y presentar un reclamo
          ante la <a href="https://spdp.gob.ec/" target="_blank" rel="noreferrer">Superintendencia de Proteccion de Datos Personales</a>.
        </p>
        <p>
          Envia tu solicitud a <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>. Podremos verificar tu identidad
          antes de entregar o modificar informacion.
        </p>
      </section>

      <section>
        <h2>7. Calculos automatizados y cambios</h2>
        <p>
          Las proyecciones y simulaciones son calculos informativos basados en tus datos; Aura no toma
          decisiones crediticias ni ejecuta operaciones financieras por ti. Si este aviso cambia de
          forma material, se informara la nueva version y se solicitara una nueva confirmacion cuando
          la normativa lo requiera.
        </p>
      </section>
    </LegalShell>
  )
}