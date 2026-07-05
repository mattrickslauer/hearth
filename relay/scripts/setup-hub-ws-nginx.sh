#!/usr/bin/env bash
#
# One-time TLS front for the Hearth relay. Run WITH SUDO on the agfarms server.
#
#   sudo DOMAIN=hub-ws.agfarms.dev UPSTREAM=127.0.0.1:8790 EMAIL=admin@agfarms.dev \
#        bash setup-hub-ws-nginx.sh
#
# Adds an ISOLATED nginx server block for $DOMAIN that reverse-proxies to the local relay
# with WebSocket upgrade headers, obtains a Let's Encrypt cert via certbot, and reloads nginx
# — but ONLY after `nginx -t` passes, so a mistake can't take down the other sites on this box.
# Safe to re-run (idempotent): it rewrites its own vhost file and re-runs certbot.

set -euo pipefail

DOMAIN="${DOMAIN:-hub-ws.agfarms.dev}"
UPSTREAM="${UPSTREAM:-127.0.0.1:8790}"
EMAIL="${EMAIL:-admin@agfarms.dev}"
SITE="/etc/nginx/sites-enabled/${DOMAIN}"

[ "$(id -u)" = "0" ] || { echo "must run as root (use sudo)"; exit 1; }
command -v nginx >/dev/null   || { echo "nginx not found"; exit 1; }
command -v certbot >/dev/null || { echo "certbot not found"; exit 1; }

echo "▸ resolving $DOMAIN"; getent hosts "$DOMAIN" || echo "  (warning: $DOMAIN does not resolve yet — certbot HTTP-01 will fail)"

# Back up any existing vhost so we can restore on failure.
BACKUP=""
if [ -f "$SITE" ]; then BACKUP="${SITE}.bak.$$"; cp -a "$SITE" "$BACKUP"; echo "▸ backed up existing $SITE → $BACKUP"; fi

echo "▸ writing $SITE (proxy → $UPSTREAM, WebSocket upgrade)"
cat > "$SITE" <<NGINX
# Managed by Hearth relay setup. WebSocket reverse proxy for the realtime relay.
map \$http_upgrade \$hearth_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$hearth_connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
NGINX

restore() {
  echo "✗ failed — restoring previous nginx state"
  if [ -n "$BACKUP" ]; then mv -f "$BACKUP" "$SITE"; else rm -f "$SITE"; fi
  nginx -t && nginx -s reload || true
  exit 1
}

echo "▸ nginx -t (port-80 vhost)"; nginx -t || restore
echo "▸ reloading nginx"; nginx -s reload

echo "▸ certbot --nginx -d $DOMAIN (adds 443 + cert + redirect)"
if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
  echo "✗ certbot failed (DNS not pointing here yet? rate limited?). The port-80 vhost is in"
  echo "  place; fix the cause and re-run. Leaving nginx serving :80 for $DOMAIN."
  exit 1
fi

echo "▸ final nginx -t"; nginx -t || restore
echo "▸ reloading nginx"; nginx -s reload
[ -n "$BACKUP" ] && rm -f "$BACKUP" || true

echo
echo "✓ $DOMAIN is live over TLS → $UPSTREAM"
echo "  test:  curl -s https://${DOMAIN}/health"
echo "  (expect: {\"ok\":true,\"sockets\":0,\"accounts\":0})"
