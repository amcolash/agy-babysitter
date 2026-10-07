#!/usr/bin/env bash
set -e

BIN_DIR="${HOME}/.local/bin"
CLI_TARGET="${BIN_DIR}/agyh"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Uninstalling agyh CLI Helper ==="

if [ -L "${CLI_TARGET}" ] || [ -f "${CLI_TARGET}" ]; then
  rm -f "${CLI_TARGET}"
  echo -e "\x1b[32m✓ Removed ${CLI_TARGET}\x1b[0m"
else
  echo "agyh is not installed in ${BIN_DIR}."
fi

"${REPO_DIR}/scripts/uninstall-hooks.sh"
