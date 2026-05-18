#!/usr/bin/env bash
# Pull latest code and rebuild containers. Run on the VPS.
#   sudo bash /opt/wce/deploy/update.sh
set -euo pipefail
cd /opt/wce
git pull --ff-only
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
docker image prune -f
docker compose ps