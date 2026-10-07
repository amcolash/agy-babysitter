#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${HOME}/.local/bin"
CLI_TARGET="${BIN_DIR}/agyh"
CLI_SRC="${REPO_DIR}/src/cli.js"

echo "=== Installing agyh CLI Helper ==="

# Ensure CLI script is executable
chmod +x "${CLI_SRC}"

# Create ~/.local/bin if not existing
mkdir -p "${BIN_DIR}"

# Create/update symlink
ln -sf "${CLI_SRC}" "${CLI_TARGET}"

echo -e "\x1b[32m✓ agyh symlinked to ${CLI_TARGET}\x1b[0m"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
  echo -e "\x1b[33mNote: ${BIN_DIR} is not currently in your PATH. You may want to add it to your ~/.bashrc or ~/.zshrc:\x1b[0m"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
else
  echo -e "\x1b[32m✓ ${CLI_TARGET} is ready to use in your shell!\x1b[0m"
fi

# Install Antigravity lifecycle hooks
"${REPO_DIR}/scripts/install-hooks.sh"

echo ""
echo "Try running: agyh --help"
