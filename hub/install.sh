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
#   HEARTH_CAM=1             attach a detected camera without asking (unattended installs;
#                            interactive installs are asked, no-tty installs are only hinted)

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

# --- offer to attach a camera ------------------------------------------------
# A machine with a webcam can be a vision sensor with one more command — but only with
# consent: a camera turning itself on during an install is creepy, so we ask. `curl | bash`
# owns stdin (bash is reading the script from it), so the answer must come from /dev/tty —
# and when there's no tty to ask (CI, scripted installs), we don't attach, we hint.
# HEARTH_CAM=1 on the install command is the explicit yes for unattended installs.
offer_camera() {
  # Already attached (this is a re-install over a configured hub) — nothing to ask;
  # `hearthctl start` above brought it up from the persisted config.
  grep -q '^HEARTH_CAM=1' "$DIR/config.env" 2>/dev/null && { ok "Camera already attached (kept)."; return 0; }
  ls /dev/video* >/dev/null 2>&1 || return 0            # nothing to attach
  command -v ffmpeg >/dev/null 2>&1 || {
    say "A camera device exists, but ffmpeg is missing. To use it as a vision sensor:"
    printf '    dnf install ffmpeg   # or: apt install ffmpeg\n    %s camera on\n\n' "$DIR/hearthctl"
    return 0
  }
  if [ "${HEARTH_CAM:-}" = "1" ]; then
    say "HEARTH_CAM=1 — attaching the camera…"
    "$DIR/hearthctl" camera on || warn "Camera attach failed — try: $DIR/hearthctl camera on"
    return 0
  fi
  if ( : </dev/tty ) 2>/dev/null; then
    printf '\033[38;5;209m▸\033[0m Camera detected — attach it as a vision sensor? It snaps a frame every few seconds for your watches. [Y/n] '
    local reply=""
    read -r reply </dev/tty || reply="n"
    case "$reply" in
      n*|N*) say "Skipped. Attach it any time with: $DIR/hearthctl camera on" ;;
      *) "$DIR/hearthctl" camera on || warn "Camera attach failed — try: $DIR/hearthctl camera on" ;;
    esac
  else
    say "Camera detected. Attach it any time with: $DIR/hearthctl camera on"
  fi
}
offer_camera

echo
say "The hub is running in the background. Manage it with:"
printf '    %s status     # running? paired? nodes ingested? camera?\n' "$DIR/hearthctl"
printf '    %s logs       # follow the log\n' "$DIR/hearthctl"
printf '    %s camera on  # attach a webcam as a vision sensor\n' "$DIR/hearthctl"
printf '    %s restart    # after a reboot, or to re-read config\n' "$DIR/hearthctl"
printf '    %s stop       # stop the hub (and the camera with it)\n' "$DIR/hearthctl"
echo
say "Tip: to start on boot, add '$DIR/hearthctl start' to your crontab (@reboot) or a login script."
