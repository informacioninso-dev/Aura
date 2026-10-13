# MEMORY — Memoria de largo plazo de Aura

> Memoria del proyecto que **viaja con el repo**: cualquier agente, en cualquier PC, la lee y la mantiene al día vía git. Cómo mantenerla: ver [AGENTS.md](AGENTS.md).
> Mantenerla **curada y timbre corto** (se carga cada sesión). Última actualización: **2026-10-13**.

## 1. Qué es Aura
App de finanzas personales en español. Muestra cuánto te queda hoy, proyecta tus próximos meses y deja **simular decisiones antes de gastar**. Posicionamiento: vende **tranquilidad** ("alguien cuida tu plata, para que vos vivas tranquilo"), no solo funcionalidad. Público joven (millennial / Gen Z): UX simple y escaneable.

Monorepo:
- `back/` — Django REST Framework (Python 3.12 local / 3.13 server).
- `front/` — React + Vite (SPA). Landing pública en `/` → `front/src/pages/home/`.
- `Aura_mobile/` — Expo / React Native (**repo git PROPIO anidado**; se commitea/pushea desde dentro).

## 2. Stack y servicios
- DB: PostgreSQL (`aura`).
- IA asistente (texto/voz): **Groq** (`GROQ_API_KEY` en `.env`).
- Email: Resend. Planes Free/Pro con features en `back/apps/usuarios/plans.py`.

## 3. Entorno local
- Backend: `Python312/python.exe manage.py runserver 8011 --noreload` desde `back/`. **Reiniciar a mano** tras cambios de modelo/serializer/views (`--noreload`).
- Frontend: Vite en **5173** (`npm run dev`); proxy lee `VITE_DEV_API_TARGET` del `.env` (ya trae `http://127.0.0.1:8011`).
- Mobile: Expo en **8081**. Validar RN sin correr: `babel-preset-expo` transform.
- La app **móvil apunta a PROD** (`https://aura.binnso.com/api/`), no al backend local.
- Cuentas de prueba locales: `demo@test.com` (Pro con datos), `nuevo@test.com` (onboarding), `admin@aura.local` (superadmin). Claves: en el entorno local / gestor (**no se commitean**).

## 4. Deploy (prod)
Server DigitalOcean `161.35.237.169` (host AURA); **convive con Folk y Academia BINNSO** — no pisar sus puertos/servicios.
- Backend: `/var/www/aura/back`, venv `.venv` (`aura-py3.13`), gunicorn `127.0.0.1:8000`, servicio **`aura-api`**, nginx → `aura.binnso.com`.
- Frontend: `/var/www/aura/front`, nginx sirve `front/dist`.

```
cd /var/www/aura/back
git pull origin main
source .venv/bin/activate        # en el server 'python' NO está en PATH sin esto
python manage.py migrate         # solo si hubo migración
systemctl restart aura-api       # solo si cambió backend (views/serializers/models)
cd /var/www/aura/front && npm run build   # solo si cambió frontend (a secas; NO npm ci: disco justo)
```
- **NO usar `deploy.sh`** (es instalación inicial, desactualizado). `collectstatic` suele ser no-op.
- Verificar: `curl -I -H 'Host: aura.binnso.com' https://aura.binnso.com` + `journalctl -u aura-api -n 20`.

## 5. Decisiones y aprendizajes clave (gotchas)

- **CSP estricto → self-host SIEMPRE.** El CSP de prod (`back/config/settings.py` `CONTENT_SECURITY_POLICY` + copia en nginx) usa `script/style/font-src 'self'`. **Cualquier recurso externo (Google Fonts, CDNs, scripts, imágenes de otro dominio) se BLOQUEA en prod** (anda en Vite dev, que no aplica CSP, pero NO en prod). Auto-hospedar todo.

- **Tipografía de marca: Plus Jakarta Sans, self-hosted** (`front/public/fonts/*.woff2` + `@font-face` en `front/src/index.css`). Stack `'Plus Jakarta Sans','Inter',system-ui,...` en index.css, layout.css y Home.css. Pendiente: llevarla al móvil.

- **IA / Asistente (Groq)** — `back/apps/finanzas/views.py`:
  - Parse (`/finanzas/asistente/parsear/`): modelo **`openai/gpt-oss-20b`** con `extra_body={'reasoning_effort':'low'}` y `max_tokens` holgado (es modelo de razonamiento: con poco presupuesto el JSON sale vacío).
  - Transcribe (`/finanzas/asistente/transcribir/`): **`whisper-large-v3-turbo`**.
  - ⚠️ Groq **deprecó `llama-3.1-8b-instant`** (sep 2026) y rompió el asistente. Si la IA "muere", revisar modelos vivos: `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"`.
  - Parse devuelve `{"movimientos":[...]}` (varios en una frase); si es **uno solo, objeto plano** (compat con clientes viejos / móvil).
  - Web usa Web Speech API del navegador para voz; Whisper es para móvil.
  - Roadmap IA: cuotas, cuentas con personas, preguntas/consultas, simular por voz. **Cuidar el costo** (modelo barato, reasoning bajo, prompts cortos).

- **Proyección ("Mi dinero")**: horizonte Pro hasta **40 años** (feature `advanced_projection_months` = 480 meses; Free limitado). Alerta de meses en rojo en la card "Si sigues así".

- **Gastos**: `GastoCorriente` (fijo/variable vía `tipo_monto`), `GastoNoCorriente` (puntual), `Diferido` (cuotas). **Versionado** de fijos: la versión vieja cierra al **fin del mes anterior** al de la nueva (evita doble conteo); chip `vN`. Navegador de mes en Fijos (`anio`/`mes` en el list). Simulador: "Agregar a mis gastos" rutea por tipo; `permitir_futuro` siembra a futuro.

- **Copy / voz (Ecuador)**: tuteo (**tú**, nunca voseo). Decir **"registrar"** (no "cargar"), no usar "vueltas" para deudas. Errores: "No pudimos … Intenta de nuevo." Éxitos cortos ("Gasto guardado.", sin "correctamente"). En gastos/ingresos fijos **"versión" se queda** (concepto del producto, no cambiarlo). El emoji **🐭 de "Cuentas con personas" es de marca: NO cambiarlo**. Guía de copy: https://claude.ai/code/artifact/cafe85ee-c488-493d-ac1f-1aa6bb9cad43

## 6. Novedades (changelog — agregar arriba)
- **2026-10-13** — Revisión de copy módulo por módulo (web + móvil) con las reglas de la sección 5. Ortografía (tildes, ñ, ¿?) en toda la web. Asistente renombrado **"Dile a Aura"** (antes "Aura AI"); se le quitó el voseo. "clave" → "contraseña" y "Free" → "Gratis" en todo lado. Textos de "simular con tasa 0%" actualizados (el Simulador ya tiene Pago único / Gasto mensual).
- **2026-10** — Asistente: varios movimientos en una frase. IA migrada a `gpt-oss-20b` (Groq deprecó el modelo anterior). Fuente Plus Jakarta self-hosted. Landing con fortalezas + ángulo emocional + SEO (JSON-LD, `<noscript>`, sitemap). Horizonte de proyección hasta 40 años.
- **2026-08/09** — Navegador de mes + chip de versión en gastos fijos; fix de doble conteo en versionado. Simulador "agregar a mis gastos" por tipo. Outlook de proyección (meses en rojo). Score de salud financiera. `pagar_el_resto` en diferidos.
