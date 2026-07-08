#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="/srv/cvc-web"

install -d -o root -g root -m 0755 "${WEB_DIR}" "${WEB_DIR}/scripts" "${WEB_DIR}/public"
install -d -o cvc-web -g cvc-web -m 0750 "${WEB_DIR}/cache"
rsync -a --delete "${ROOT_DIR}/public/" "${WEB_DIR}/public/"
install -o root -g root -m 0644 "${ROOT_DIR}/scripts/public-static-server.mjs" "${WEB_DIR}/scripts/public-static-server.mjs"
find "${WEB_DIR}" -type d -exec chmod 0755 {} +
find "${WEB_DIR}" -type f -exec chmod 0644 {} +
chown -R cvc-web:cvc-web "${WEB_DIR}/cache"
chmod 0750 "${WEB_DIR}/cache"
find "${WEB_DIR}/cache" -type f -exec chmod 0600 {} +

systemctl restart cvc-web.service
systemctl --no-pager --full status cvc-web.service
