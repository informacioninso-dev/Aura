#!/bin/bash
# =============================================================================
# deploy.sh — Script de despliegue de Aura en servidor VPS (Ubuntu 22.04+)
# Ejecutar como root en el VPS: bash deploy.sh
# =============================================================================
set -e

DOMAIN="aura.binnso.com"
APP_DIR="/var/www/aura"
APP_USER="aura"

echo "=============================="
echo " Desplegando Aura en $DOMAIN"
echo "=============================="

# ── 1. Sistema base ────────────────────────────────────────────────────────────
apt-get update -y
apt-get install -y python3 python3-pip python3-venv python3-dev \
    postgresql postgresql-contrib redis-server nginx certbot python3-certbot-nginx \
    git curl build-essential libpq-dev

# ── 2. Node.js 22.22+ (para build de React) ───────────────────────────────────────
if ! command -v node &> /dev/null || ! dpkg --compare-versions "$(node -p 'process.versions.node')" ge "22.22.0"; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
fi

# ── 3. Usuario de sistema ──────────────────────────────────────────────────────
if ! id "$APP_USER" &>/dev/null; then
    useradd --system --shell /bin/bash --home "$APP_DIR" "$APP_USER"
fi

# ── 4. Directorios ────────────────────────────────────────────────────────────
mkdir -p "$APP_DIR" /var/www/aura/front "$APP_DIR/back/media"
chown -R "$APP_USER":www-data "$APP_DIR"

echo ""
echo "──────────────────────────────────────────────────"
echo " PASO MANUAL: Sube tu código al servidor ahora."
echo " Opción 1 (recomendado): git clone tu repo en $APP_DIR"
echo " Opción 2: scp -r ./back ./front $APP_USER@$DOMAIN:$APP_DIR/"
echo ""
echo " Cuando el código esté en $APP_DIR, presiona ENTER"
echo "──────────────────────────────────────────────────"
read -r

# ── 5. PostgreSQL ──────────────────────────────────────────────────────────────
echo "[5/9] Configurando PostgreSQL..."
DB_PASS=$(openssl rand -base64 24)
sudo -u postgres psql -c "CREATE USER aura WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE aura OWNER aura;" 2>/dev/null || true
echo "  DB_PASSWORD generado: $DB_PASS  (guárdalo en .env)"

# ── 6. Backend Django ──────────────────────────────────────────────────────────
echo "[6/9] Configurando backend..."
cd "$APP_DIR/back"

# Crear .env desde .env.example si no existe
if [ ! -f .env ]; then
    cp .env.example .env
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")
    ENCRYPTION_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
    sed -i "s|cambia-esto-por-una-clave-secreta-real|$SECRET_KEY|" .env
    sed -i "s|cambia-esto-por-una-password-segura|$DB_PASS|" .env
    sed -i "s|cambia-esto-por-una-passphrase-larga-y-unica|$ENCRYPTION_KEY|" .env
    echo "  Archivo .env creado. Revísalo antes de continuar:"
    echo "  nano $APP_DIR/back/.env"
fi

if ! grep -q '^REDIS_URL=' .env; then
    printf '\nREDIS_URL=redis://127.0.0.1:6379/1\n' >> .env
fi
systemctl enable --now redis-server

# Entorno virtual + dependencias
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install gunicorn psycopg2-binary

# Instalar dependencias del proyecto (sin Poetry en producción)
.venv/bin/pip install \
    "django>=5.2.7,<6.0.0" \
    "pillow>=12.1.0" \
    "djangorestframework>=3.17.1" \
    "djangorestframework-simplejwt>=5.5.1" \
    "django-cors-headers>=4.9.0" \
    "gunicorn>=23.0.0" \
    "psycopg2-binary>=2.9.0" \
    "openpyxl>=3.1.0" \
    "cryptography>=48.0.1,<49.0.0" \
    "reportlab>=4.4.0"

# Migraciones y archivos estáticos
set -a; source .env; set +a
.venv/bin/python manage.py migrate --noinput
.venv/bin/python manage.py collectstatic --noinput
chown -R "$APP_USER":www-data "$APP_DIR/back"

# ── 7. Frontend React ──────────────────────────────────────────────────────────
echo "[7/9] Compilando frontend..."
cd "$APP_DIR/front"
npm ci
npm run build
rsync -a dist/ /var/www/aura/front/
echo "  Frontend compilado y copiado a /var/www/aura/front/"

# ── 8. Systemd ────────────────────────────────────────────────────────────────
echo "[8/9] Configurando servicio systemd..."
install -d -o "$APP_USER" -g www-data -m 0750 "$APP_DIR/back/media"
cp "$APP_DIR/systemd/aura-api.service" /etc/systemd/system/aura-api.service
systemctl daemon-reload
systemctl enable aura-api
systemctl restart aura-api
systemctl status aura-api --no-pager

# 9. Nginx + SSL
echo "[9/9] Configurando Nginx y SSL..."
install -d -m 0755 /etc/nginx/snippets
cp "$APP_DIR/nginx/security-headers.conf" /etc/nginx/snippets/aura-security-headers.conf
cp "$APP_DIR/nginx/aura.conf" /etc/nginx/sites-available/aura
ln -sf /etc/nginx/sites-available/aura /etc/nginx/sites-enabled/aura
rm -f /etc/nginx/sites-enabled/default
nginx -t

# SSL con Let's Encrypt
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@binnso.com --redirect

systemctl reload nginx

echo ""
echo "=============================="
echo " ✓ Aura desplegado en https://$DOMAIN"
echo "=============================="
echo ""
echo "Comandos útiles:"
echo "  Ver logs Django:  journalctl -u aura-api -f"
echo "  Reiniciar app:    systemctl restart aura-api"
echo "  Ver logs Nginx:   tail -f /var/log/nginx/error.log"
