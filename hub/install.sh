#!/usr/bin/env bash
#
# Hearth hub installer — one command, no Docker.
#
#   curl -fsSL https://raw.githubusercontent.com/mattrickslauer/hearth/main/hub/install.sh | bash
#
# Installs the single-process hub agent into ~/.hearth, starts it as a background
# service, and prints your pairing CODE. Enter that code in your Hearth dashboard →
# "Connect a hub". The hub then advertises itself on your LAN (mDNS), ingests your
# ESP32 nodes, and syncs them to your account.
#
# Manage it afterwards:   ~/.hearth/hearthctl {start|stop|restart|status|logs|code}
#
# Env overrides:
#   HEARTH_HOME=/path        where the hub + identity + logs live (default ~/.hearth)
#   BACKEND_URL=http://…     point at a different backend (default: Hearth Cloud)
#   HUB_NAME="Kitchen Pi"    display name shown on the dashboard (default: hostname)
#   HEARTH_REF=main          git ref to pull from (default main)
#   HEARTH_INSTALL_ONLY=1    install but don't start
#   HEARTH_NO_MDNS=1         skip the mDNS dependency (nodes use HUB_ENDPOINT instead)

set -euo pipefail

REPO_RAW="${HEARTH_REPO_RAW:-https://raw.githubusercontent.com/mattrickslauer/hearth}"
REF="${HEARTH_REF:-main}"
DIR="${HEARTH_HOME:-$HOME/.hearth}"
DASHBOARD_URL="${HEARTH_DASHBOARD_URL:-https://hearth.vercel.app}"

say()  { printf '\033[38;5;209m▸\033[0m %s\n' "$1"; }
ok()   { printf '\033[38;5;42m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[38;5;214m!\033[0m %s\n' "$1"; }
die()  { printf '\033[38;5;196m✗\033[0m %s\n' "$1" >&2; exit 1; }

# --- prerequisites ---------------------------------------------------------
command -v curl >/dev/null 2>&1 || die "curl is required but not installed."
if ! command -v node >/dev/null 2>&1; then
  die "Node.js 18+ is required but 'node' was not found.
    macOS:  brew install node
    Linux:  https://github.com/nvm-sh/nvm  →  nvm install --lts
    Then re-run this installer."
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 18+ is required (found $(node -v)). Upgrade Node and re-run."

# --- install files ---------------------------------------------------------
# EVERY module hub.mjs imports, transitively, must be listed here — a missing one makes the
# hub die on startup with ERR_MODULE_NOT_FOUND. The import graph is:
#   hub.mjs → ws.mjs → ws-frame.mjs
#           → node.mjs → camera.mjs → wire.mjs   (the embedded camera node, HEARTH_CAM=1;
#                                                 node.mjs also runs standalone: a laptop as a node)
#           → runtime.mjs → engine.mjs, notify.mjs
# `hearthctl start` verifies the process actually survives, so if this list ever falls behind
# again the installer fails loudly instead of leaving a hub that silently won't boot.
HUB_FILES="hub.mjs ws.mjs ws-frame.mjs runtime.mjs engine.mjs notify.mjs node.mjs camera.mjs wire.mjs hearthctl"

say "Installing the Hearth hub into $DIR"
mkdir -p "$DIR"
for f in $HUB_FILES; do
  curl -fsSL "$REPO_RAW/$REF/hub/$f" -o "$DIR/$f" || die "Download failed: $f"
done
chmod +x "$DIR/hub.mjs" "$DIR/hearthctl"

# Catch a truncated/incomplete download before it becomes a confusing runtime error.
for f in $HUB_FILES; do
  case "$f" in *.mjs) node --check "$DIR/$f" 2>/dev/null || die "Downloaded $f is not valid JavaScript — re-run the installer." ;; esac
done

# Minimal package.json so `npm install` can pull the (optional) mDNS dependency.
cat >"$DIR/package.json" <<'JSON'
{
  "name": "hearth-hub",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "dependencies": { "bonjour-service": "^1.2.1" },
  "engines": { "node": ">=18" }
}
JSON

# --- optional mDNS dependency (zero-config node discovery) ------------------
if [ "${HEARTH_NO_MDNS:-}" = "1" ]; then
  warn "Skipping mDNS (HEARTH_NO_MDNS=1). Point nodes at this hub via HUB_ENDPOINT."
elif command -v npm >/dev/null 2>&1; then
  say "Installing mDNS support (bonjour-service)…"
  ( cd "$DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error ) \
    && ok "mDNS ready — ESP32 nodes will discover this hub automatically." \
    || warn "mDNS install failed — the hub still works; nodes just need HUB_ENDPOINT set."
else
  warn "npm not found — installing without mDNS. Nodes will need HUB_ENDPOINT set."
fi

# --- export the env the service should run with ----------------------------
# hearthctl launches hub.mjs; pass through the operator's chosen backend/name/home.
export HEARTH_HOME="$DIR"
[ -n "${BACKEND_URL:-}" ] && export BACKEND_URL
[ -n "${HUB_NAME:-}" ]    && export HUB_NAME

if [ "${HEARTH_INSTALL_ONLY:-}" = "1" ]; then
  ok "Installed. Start it any time with:"
  printf '\n    %s start\n\n' "$DIR/hearthctl"
  exit 0
fi

# --- start the background service ------------------------------------------
say "Starting the hub in the background…"
"$DIR/hearthctl" start

# --- surface the pairing code ----------------------------------------------
say "Waiting for your pairing code…"
CODE=""
for _ in $(seq 1 40); do        # up to ~20s
  if [ -s "$DIR/claim-code.txt" ]; then CODE="$(cat "$DIR/claim-code.txt")"; break; fi
  sleep 0.5
done

echo
if [ -n "$CODE" ]; then
  printf '  \033[38;5;209m┌─────────────────────────────────────────────┐\033[0m\n'
  printf '  \033[38;5;209m│\033[0m  Enter this code in your Hearth dashboard:    \033[38;5;209m│\033[0m\n'
  printf '  \033[38;5;209m│\033[0m                                               \033[38;5;209m│\033[0m\n'
  printf '  \033[38;5;209m│\033[0m            >>>   \033[1m%s\033[0m   <<<            \033[38;5;209m│\033[0m\n' "$CODE"
  printf '  \033[38;5;209m│\033[0m                                               \033[38;5;209m│\033[0m\n'
  printf '  \033[38;5;209m└─────────────────────────────────────────────┘\033[0m\n\n'
  ok "Open $DASHBOARD_URL → \"Connect a hub\" and enter $CODE"
else
  warn "Didn't catch the code in time — the hub is running. Get it with:"
  printf '\n    %s code\n\n' "$DIR/hearthctl"
fi

echo
say "The hub is running in the background. Manage it with:"
printf '    %s status     # running? paired? nodes ingested?\n' "$DIR/hearthctl"
printf '    %s logs       # follow the log\n' "$DIR/hearthctl"
printf '    %s restart    # after a reboot, or to re-read config\n' "$DIR/hearthctl"
echo
say "Tip: to start on boot, add '$DIR/hearthctl start' to your crontab (@reboot) or a login script."
