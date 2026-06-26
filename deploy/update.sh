#!/usr/bin/env bash
# Pull latest code and rebuild containers. Run on the VPS.
#   sudo bash /opt/wce/deploy/update.sh
set -euo pipefail
cd /opt/wce
git pull --ff-only

# Sync API static GeoJSON onto the host data volume. The api container
# bind-mounts ./data over /app/data, which SHADOWS files baked into the image
# from apps/api/data/. Hand-authored datasets the API serves (offshore-wind,
# wind-projects.districts) must live on the host volume or their routes 503.
cp -f apps/api/data/*.geojson data/ 2>/dev/null || true

docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
docker image prune -f
docker compose ps