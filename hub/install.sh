#!/usr/bin/env bash
#
# Hearth hub installer.
#
#   curl -fsSL https://raw.githubusercontent.com/mattrickslauer/hearth/main/hub/install.sh | bash
#
# Downloads the (zero-dependency, Node 18+) hub agent to ~/.hearth and starts it.
# The agent prints a claim code — enter it in your Hearth dashboard → "Connect a hub".
#
# Env overrides:
#   HEARTH_HOME=/path        where the agent + its identity live (default ~/.hearth)
#   BACKEND_URL=http://…     point at a different backend (default: Hearth Cloud)
#   HUB_NAME="Kitchen Pi"    display name shown on the dashboard (default: hostname)
#   HEARTH_INSTALL_ONLY=1    install but don't start the agent
#   HEARTH_REF=main          git ref to pull the agent from (default main)

set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/mattrickslauer/hearth"
REF="${HEARTH_REF:-main}"
INSTALL_DIR="${HEARTH_HOME:-$HOME/.hearth}"
AGENT_URL="$REPO_RAW/$REF/hub/hearth-hub.mjs"
AGENT_PATH="$INSTALL_DIR/hearth-hub.mjs"

say() { printf '\033[38;5;209m▸\033[0m %s\n' "$1"; }
die() { printf '\033[38;5;196m✗\033[0m %s\n' "$1" >&2; exit 1; }

# --- prerequisites ---------------------------------------------------------
command -v curl >/dev/null 2>&1 || die "curl is required but not installed."

if ! command -v node >/dev/null 2>&1; then
  die "Node.js 18+ is required but 'node' was not found.
    Install it from https://nodejs.org (LTS), or via a version manager:
      macOS:  brew install node
      Linux:  https://github.com/nvm-sh/nvm  →  nvm install --lts
    Then re-run this installer."
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js 18+ is required (found $(node -v)). Please upgrade Node and re-run."
fi

# --- install ---------------------------------------------------------------
say "Installing the Hearth hub into $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
curl -fsSL "$AGENT_URL" -o "$AGENT_PATH" || die "Download failed: $AGENT_URL"
chmod +x "$AGENT_PATH"
say "Installed $(node -e 'const m=require("os");process.stdout.write("hub agent for "+m.hostname())' 2>/dev/null || echo 'hub agent')."

# --- run -------------------------------------------------------------------
if [ "${HEARTH_INSTALL_ONLY:-}" = "1" ]; then
  say "Done. Start it any time with:"
  printf '\n    node %s\n\n' "$AGENT_PATH"
  say "To keep it running as a service, wrap that command in systemd / launchd / pm2."
  exit 0
fi

say "Starting the hub. It will print a claim code — enter it in your Hearth dashboard."
say "(Press Ctrl-C to stop. Re-run 'node $AGENT_PATH' to restart; it keeps its identity.)"
echo
exec node "$AGENT_PATH"
