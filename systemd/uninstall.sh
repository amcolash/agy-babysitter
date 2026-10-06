#!/usr/bin/env bash
set -e

SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"

echo "=== Uninstalling agy-babysitter Systemd Service ==="

systemctl --user stop agy-babysitter.service 2>/dev/null || true
systemctl --user disable agy-babysitter.service 2>/dev/null || true
rm -f "${SYSTEMD_USER_DIR}/agy-babysitter.service"
systemctl --user daemon-reload

echo "=== Service uninstalled ==="
