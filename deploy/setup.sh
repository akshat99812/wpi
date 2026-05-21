#!/usr/bin/env bash
# Run on a fresh Ubuntu VPS as root, AFTER:
#   1. DNS A records for windpowerindia.com, www, api all point to this box
#   2. The repo has been cloned/rsynced to /opt/wce
#
# Usage:  sudo bash /opt/wce/deploy/setup.sh you@youremail.com

set -euo pipefail

CERTBOT_EMAIL="${1:-}"
if [ -z "$CERTBOT_EMAIL" ]; then
  echo "Usage: $0 <email-for-letsencrypt>"
  exit 1
fi

REPO_DIR="/opt/wce"
cd "$REPO_DIR"

echo "==> [1/7] System packages"
apt update
apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx git curl

echo "==> [2/7] Docker (if missing)"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

echo "==> [3/7] Firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> [4/7] Swap (helps with Next.js build on small VPS)"
if ! swapon --show | grep -q /swap; then
  fallocate -l 2G /swap
  chmod 600 /swap
  mkswap /swap
  swapon /swap
  grep -q '/swap' /etc/fstab || echo '/swap none swap sw 0 0' >> /etc/fstab
fi

echo "==> [5/7] .env"
if [ ! -f "$REPO_DIR/.env" ]; then
  cp "$REPO_DIR/deploy/.env.production.example" "$REPO_DIR/.env"
  sed -i "s/REPLACE_ME_WITH_LONG_RANDOM_HEX/$(openssl rand -hex 32)/" "$REPO_DIR/.env"
  echo "    Generated $REPO_DIR/.env with a random admin token."
fi

echo "==> [6/7] Build & start containers (HTTP only for now)"
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
sleep 5
docker compose ps

echo "==> [7/7] Nginx + Let's Encrypt"
cp "$REPO_DIR/deploy/nginx/windpowerindia.com.conf"           /etc/nginx/sites-available/
cp "$REPO_DIR/deploy/nginx/api.windpowerindia.com.conf"       /etc/nginx/sites-available/
cp "$REPO_DIR/deploy/nginx/analytics.windpowerindia.com.conf" /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/windpowerindia.com.conf           /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/api.windpowerindia.com.conf       /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/analytics.windpowerindia.com.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "    DNS sanity check..."
for host in windpowerindia.com www.windpowerindia.com api.windpowerindia.com analytics.windpowerindia.com; do
  ip=$(dig +short "$host" | tail -n1)
  echo "      $host -> ${ip:-<no record>}"
done

echo "    Running certbot — this requires DNS to be propagated."
certbot --nginx \
  -d windpowerindia.com -d www.windpowerindia.com -d api.windpowerindia.com -d analytics.windpowerindia.com \
  --redirect --agree-tos -m "$CERTBOT_EMAIL" --no-eff-email -n

echo
echo "Done."
echo "  https://windpowerindia.com"
echo "  https://api.windpowerindia.com/health"
echo "  https://analytics.windpowerindia.com  (Umami — finish first-time setup in the browser)"
