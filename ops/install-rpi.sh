#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/apps/cabras-chat}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Preparing directories in ${APP_DIR}"
mkdir -p "${APP_DIR}"
mkdir -p "${APP_DIR}/config"
mkdir -p "${APP_DIR}/data/uploads"
mkdir -p "${APP_DIR}/data/private-transfers"
mkdir -p "${APP_DIR}/public/backgrounds"

echo "==> Installing Node dependencies"
cd "${REPO_DIR}"
npm ci --omit=dev

if [ ! -f "${REPO_DIR}/.env" ]; then
  echo "==> Creating .env from .env.example"
  cp "${REPO_DIR}/.env.example" "${REPO_DIR}/.env"
fi

if [ ! -f "${REPO_DIR}/config/chat-users.json" ]; then
  echo "==> Creating config/chat-users.json from example"
  cp "${REPO_DIR}/config/chat-users.example.json" "${REPO_DIR}/config/chat-users.json"
fi

echo
echo "Bootstrap complete."
echo
echo "Next steps:"
echo "1. Edit ${REPO_DIR}/.env"
echo "2. Edit ${REPO_DIR}/config/chat-users.json"
echo "3. Copy ops/fastify-api.service.example into /etc/systemd/system/"
echo "4. Restart systemd: sudo systemctl daemon-reload && sudo systemctl enable --now fastify-api"
