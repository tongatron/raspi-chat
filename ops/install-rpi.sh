#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/apps/raspi-chat}"
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
echo "3. Complete the wizard and let it generate the real .env, users file and finish-setup.sh"
echo "4. Run: sudo bash ${REPO_DIR}/data/setup-generated/finish-setup.sh"
