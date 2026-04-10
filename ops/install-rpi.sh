#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/apps/cabras-chat}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SETUP_URL="${SETUP_URL:-http://127.0.0.1:3000/setup}"

echo "==> Preparing directories in ${APP_DIR}"
mkdir -p "${APP_DIR}"
mkdir -p "${APP_DIR}/config"
mkdir -p "${APP_DIR}/data"
mkdir -p "${APP_DIR}/data/uploads"
mkdir -p "${APP_DIR}/data/setup-generated"
mkdir -p "${APP_DIR}/public/backgrounds"

echo "==> Installing Node dependencies"
cd "${REPO_DIR}"
npm ci --omit=dev

echo
echo "Bootstrap complete."
echo
echo "Next steps:"
echo "1. Start the app once: cd ${REPO_DIR} && npm start"
echo "2. Open the setup wizard: ${SETUP_URL}"
echo "3. Complete the wizard and let it generate the real .env and users file"
echo "4. Copy the generated service file from ${REPO_DIR}/data/setup-generated/fastify-api.service"
echo "5. Enable systemd: sudo systemctl daemon-reload && sudo systemctl enable --now fastify-api"
