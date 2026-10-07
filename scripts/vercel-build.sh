#!/usr/bin/env bash
# Builds the workspaces the Nightschool site depends on before Vite runs.
#
# The site needs the compiled contract (bindings and proving keys), which needs
# the Compact toolchain. It isn't on Vercel's build image, so install it here.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! compact --version >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -LsSf \
    https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"
compact update 0.31.1

npm run build -w @nightschool/contract
npm run build -w @nightschool/api
npm run build -w @nightschool/ui
