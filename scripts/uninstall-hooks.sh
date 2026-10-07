#!/usr/bin/env bash
set -e

CONFIG_DIR="${HOME}/.gemini/config"
HOOKS_FILE="${CONFIG_DIR}/hooks.json"
SHARE_DIR="${HOME}/.local/share/agy-babysitter"

echo "=== Removing Antigravity Lifecycle Hooks for agy-babysitter ==="

if [[ -f "${HOOKS_FILE}" ]]; then
  node -e "
  const fs = require('fs');
  try {
    const raw = fs.readFileSync('${HOOKS_FILE}', 'utf-8');
    if (raw.trim()) {
      const hooks = JSON.parse(raw);
      if (hooks['agy-babysitter']) {
        delete hooks['agy-babysitter'];
        fs.writeFileSync('${HOOKS_FILE}', JSON.stringify(hooks, null, 2) + '\n');
        console.log('✓ Removed agy-babysitter entry from ${HOOKS_FILE}');
      }
    }
  } catch (e) {}
  "
fi

rm -rf "${SHARE_DIR}/hooks"
echo -e "\x1b[32m✓ agy-babysitter hooks uninstalled.\x1b[0m"
