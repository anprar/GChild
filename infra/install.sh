#!/usr/bin/env bash
# Pemasang GChild untuk VPS Ubuntu/Debian (root).
#
# Sekali jalan, tanpa scp/copy manual:
#   git clone https://github.com/anprar/GChild.git /tmp/gchild
#   sudo bash /tmp/gchild/infra/install.sh
#
# Idempoten: jalankan ulang untuk memperbarui (git pull + npm ci + migrate + restart).
# Tidak menyentuh firewall, tidak memasang reverse proxy, tidak menimpa .env yang sudah ada.
set -euo pipefail

REPO_URL="${GCHILD_REPO_URL:-https://github.com/anprar/GChild.git}"
BRANCH="${GCHILD_BRANCH:-main}"
APP_DIR="/opt/gchild/app"
DATA_DIR="/opt/gchild/data"
SERVICE_USER="gchild"
UNIT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gchild.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "Jalankan sebagai root (sudo bash infra/install.sh)." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Installer ini mendukung Ubuntu/Debian (apt). Sesuaikan manual untuk distro lain." >&2
  exit 1
fi

echo "==> Paket dasar"
apt-get update -y
apt-get install -y git curl ca-certificates build-essential python3

echo "==> Node.js >= 22"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version
npm --version

echo "==> User sistem $SERVICE_USER"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /opt/gchild --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "==> Kode aplikasi di $APP_DIR"
mkdir -p /opt/gchild
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

mkdir -p "$DATA_DIR"

# .env hanya dibuat sekali; jangan menimpa token/pepper yang sudah diisi operator.
if [ ! -f "$APP_DIR/.env" ]; then
  PEPPER="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
  cat >"$APP_DIR/.env" <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_PATH=$DATA_DIR/gchild.sqlite
LOG_LEVEL=info

PAIRING_CODE_PEPPER=$PEPPER

# Isi token dari @BotFather. Kosong = kanal bot Parent nonaktif.
TELEGRAM_BOT_TOKEN=
TELEGRAM_PARENT_IDS=

PAIRING_CODE_TTL_SECONDS=600
ENROLLMENT_TTL_SECONDS=900
COMMAND_TTL_SECONDS=120
COMMAND_LEASE_SECONDS=30
STATUS_STALE_SECONDS=900
RETENTION_DAYS=30
TELEGRAM_NOTIFIER_INTERVAL_MS=5000
EOF
  chmod 600 "$APP_DIR/.env"
  echo "    .env baru dibuat (token Telegram masih kosong)."
fi

chown -R "$SERVICE_USER:$SERVICE_USER" /opt/gchild

echo "==> Dependency + migrasi"
runuser -u "$SERVICE_USER" -- bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund"
runuser -u "$SERVICE_USER" -- bash -c "cd '$APP_DIR' && npm run migrate"

echo "==> systemd unit"
install -m 0644 "$UNIT_SRC" /etc/systemd/system/gchild.service
systemctl daemon-reload
systemctl enable gchild >/dev/null
systemctl restart gchild
sleep 2
systemctl --no-pager --lines=5 status gchild || true

cat <<EOF

GChild terpasang.
  API      : http://<IP-VPS>:3000/v1/healthz
  env      : $APP_DIR/.env
  database : $DATA_DIR/gchild.sqlite
  service  : systemctl status|restart|logs gchild

Langkah manual berikutnya (tidak dilakukan installer):
  1. Isi TELEGRAM_BOT_TOKEN di $APP_DIR/.env, lalu: systemctl restart gchild
  2. Daftarkan owner Telegram:
     runuser -u $SERVICE_USER -- bash -c "cd $APP_DIR && npm run admin:create -w apps/backend -- --telegram-id=<ID> --family-name='Keluarga'"
  3. Buka port 3000 sesuai kebijakan firewall VPS (mis. ufw allow 3000/tcp).
  4. Untuk produksi, taruh reverse proxy HTTPS (mis. Caddy + domain) di depan port 3000
     dan pakai URL https itu untuk build APK release.
EOF
