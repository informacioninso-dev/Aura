import LegalShell, { LEGAL_EMAIL } from './LegalShell'

export default function TermsOfUse() {
  return (
    <LegalShell
      eyebrow="ANTES DE DECIDIR"
      title="Terminos de Uso"
      summary="Aura organiza informacion y muestra escenarios. La decision final siempre necesita tu criterio y datos correctos."
    >
      <section>
        <h2>1. Que es Aura</h2>
        <p>
          Aura es una herramienta de organizacion financiera personal. Registra la informacion que
          proporcionas y genera balances, proyecciones y simulaciones para ayudarte a comprender
          posibles escenarios. Aura no mueve dinero, no concede credito y no ejecuta inversiones.
        </p>
      </section>

      <section className="legal-highlight">
        <h2>2. Descargo financiero</h2>
        <p>
          Aura no reemplaza asesoria financiera, contable, tributaria, legal ni de inversion. Sus
          resultados son estimaciones, no garantias ni recomendaciones personalizadas. Antes de una
          decision importante debes revisar el escenario, considerar riesgos que la aplicacion no
          conoce y, cuando corresponda, consultar a un profesional calificado.
        </p>
      </section>

      <section>
        <h2>3. La calidad del resultado depende de tus datos</h2>
        <p>
          Eres responsable de registrar rubros completos, correctos y actualizados. Omitir gastos,
          duplicar ingresos, usar fechas equivocadas o dejar valores desactualizados puede producir
          conclusiones incorrectas. Debes verificar los resultados antes de asumir una deuda, compra
          o compromiso futuro.
        </p>
      </section>

      <section>
        <h2>4. Responsabilidad</h2>
        <p>
          En la maxima medida permitida por la ley, Aura y su operador no responden por perdidas
          derivadas exclusivamente de decisiones tomadas por el usuario con base en datos incompletos,
          incorrectos o desactualizados, ni por tratar una simulacion como una garantia. Nada en estos
          terminos excluye responsabilidades que legalmente no puedan limitarse.
        </p>
      </section>

      <section>
        <h2>5. Cuenta y uso permitido</h2>
        <ul>
          <li>Debes proteger tus credenciales y avisar si detectas acceso no autorizado.</li>
          <li>No puedes intentar vulnerar, sobrecargar, automatizar abusivamente o interferir con Aura.</li>
          <li>No debes usar la aplicacion para fraude, suplantacion ni actividades ilegales.</li>
          <li>Si no tienes capacidad legal para aceptar estos terminos, debes usar Aura con tu representante.</li>
        </ul>
      </section>

      <section>
        <h2>6. Planes, disponibilidad y cambios</h2>
        <p>
          Algunas funciones requieren un plan de pago. El precio y alcance se muestran antes de
          contratar. Puedes gestionar la continuidad de tu suscripcion desde tu perfil conforme a
          las condiciones informadas. Podemos corregir errores, mantener el servicio o cambiar
          funciones; los cambios materiales de estos terminos se comunicaran mediante una nueva version.
        </p>
      </section>

      <section>
        <h2>7. Privacidad, terminacion y ley aplicable</h2>
        <p>
          El tratamiento de datos se explica en el <a href="/privacidad">Aviso de Privacidad</a>.
          Podemos restringir una cuenta por incumplimiento, riesgo de seguridad o exigencia legal.
          Estos terminos se interpretan conforme a la normativa aplicable en Ecuador, sin limitar los
          derechos irrenunciables del consumidor o titular de datos.
        </p>
        <p>Consultas: <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.</p>
      </section>
    </LegalShell>
  )
}