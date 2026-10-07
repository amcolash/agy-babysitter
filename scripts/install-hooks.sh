#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHARE_DIR="${HOME}/.local/share/agy-babysitter/hooks"
CONFIG_DIR="${HOME}/.gemini/config"
HOOKS_FILE="${CONFIG_DIR}/hooks.json"

echo "=== Installing Antigravity Lifecycle Hooks for agy-babysitter ==="

# 1. Symlink hook script to ~/.local/share/agy-babysitter/hooks/
mkdir -p "${SHARE_DIR}"
chmod +x "${REPO_DIR}/hooks/notify.cjs"
ln -sf "${REPO_DIR}/hooks/notify.cjs" "${SHARE_DIR}/notify.cjs"
echo -e "\x1b[32m✓ Hook script installed to ${SHARE_DIR}/notify.cjs\x1b[0m"

# 2. Register hook in ~/.gemini/config/hooks.json
mkdir -p "${CONFIG_DIR}"

node -e "
const fs = require('fs');
const path = require('path');

const hooksFile = '${HOOKS_FILE}';
let hooks = {};

if (fs.existsSync(hooksFile)) {
  try {
    const raw = fs.readFileSync(hooksFile, 'utf-8');
    if (raw.trim()) {
      hooks = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Warning: Could not parse existing hooks.json, creating a new structure.');
  }
}

hooks['agy-babysitter'] = {
  PreInvocation: [
    {
      type: 'command',
      command: 'node ${SHARE_DIR}/notify.cjs pre_invocation',
      timeout: 2
    }
  ],
  Stop: [
    {
      type: 'command',
      command: 'node ${SHARE_DIR}/notify.cjs stop',
      timeout: 2
    }
  ],
  PreToolUse: [
    {
      matcher: 'ask_question',
      hooks: [
        {
          type: 'command',
          command: 'node ${SHARE_DIR}/notify.cjs ask_question',
          timeout: 2
        }
      ]
    }
  ]
};

fs.writeFileSync(hooksFile, JSON.stringify(hooks, null, 2) + '\n');
console.log('✓ Registered agy-babysitter hooks in ' + hooksFile);
"

echo -e "\x1b[32m✓ Global Antigravity hooks configured successfully!\x1b[0m"
