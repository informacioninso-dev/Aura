# Aura - Checklist De Salida A Produccion

## 1) Preflight tecnico (obligatorio)
- Backend:
  - `cd back`
  - `py -3.13 manage.py check --deploy`
  - `py -3.13 manage.py migrate --noinput`
  - `py -3.13 manage.py test apps.usuarios apps.finanzas apps.simulador`
- Frontend:
  - `cd front`
  - `npm run lint`
  - `npm run build`

## 2) Variables de entorno minimas (backend)
- `AURA_ENV=production`
- `DJANGO_DEBUG=0`
- `DJANGO_SECRET_KEY=<clave larga y aleatoria>`
- `DJANGO_ALLOWED_HOSTS=<tu-dominio>`
- `DJANGO_CSRF_TRUSTED_ORIGINS=https://<tu-dominio>`
- `DJANGO_CORS_ALLOWED_ORIGINS=https://<tu-dominio>`
- `DB_ENGINE=django.db.backends.postgresql`
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`

Referencia: [back/.env.example](C:/Users/Francisco%20Bravo/Desktop/Aura/back/.env.example)

## 3) Smoke manual en navegador (10-15 min)
1. Registro:
  - Crear usuario nuevo.
  - Esperado: login automatico o acceso al dashboard sin error.
2. Login:
  - Cerrar sesion e iniciar con el usuario creado.
  - Esperado: acceso correcto y tokens validos.
3. Ingresos:
  - Crear, editar y eliminar un ingreso.
  - Esperado: tabla y totales se actualizan.
4. Gastos corrientes:
  - Crear, editar y eliminar.
  - Esperado: tabla y resumen mensual se actualizan.
5. Diferidos:
  - Crear diferido con cuotas.
  - Esperado: cuota mensual calculada y visible.
6. Simulador:
  - Intentar guardar con colchon minimo `0`.
  - Esperado: validacion bloquea.
  - Ejecutar simulacion valida y guardarla.
  - Esperado: aparece en listado; luego eliminarla.
7. Reportes:
  - Abrir reporte mensual y descargar CSV/PDF.
  - Esperado: ambos archivos se generan.

## 4) Go/No-Go
- GO solo si:
  - Sin errores 5xx en logs.
  - Smoke manual completo aprobado.
  - `check --deploy` sin issues.
  - Backup de DB probado (restore validado).

## 5) Post-deploy inmediato
- Verificar:
  - `https://<tu-dominio>/`
  - `https://<tu-dominio>/api/usuarios/login/` (GET debe responder 405)
- Monitorear 30-60 min:
  - latencia API
  - errores 4xx/5xx
  - uso de CPU/RAM
