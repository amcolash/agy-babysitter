#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"

echo "=== Installing agy-babysitter Systemd Service ==="

# Build client assets once
echo "Building frontend assets..."
(cd "${REPO_DIR}" && npm run build)

# Symlink unit file
mkdir -p "${SYSTEMD_USER_DIR}"
ln -sf "${REPO_DIR}/systemd/agy-babysitter.service" "${SYSTEMD_USER_DIR}/agy-babysitter.service"

# Install CLI helper symlink
echo "Installing CLI helper (agyh)..."
(cd "${REPO_DIR}" && npm run cli:install)

# Reload and enable service
systemctl --user daemon-reload
systemctl --user enable --now agy-babysitter.service

echo "=== Service installed and running ==="
systemctl --user status agy-babysitter.service --no-pager
