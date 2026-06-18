#!/usr/bin/env bash
# Golden-corpus capture harness for the site-analysis parity migration (runbook §1.4).
# Freezes the LEGACY engine's exact responses as the parity oracle.
#
# AUTH (you provide it — this script never reads/stores your session itself):
#   The endpoint is Pro-gated. Sign in with YOUR password (email+password is enabled,
#   no verification) and export the resulting cookie. Example:
#
#     curl -s -c /tmp/wpi.cookies -X POST http://localhost:3005/api/auth/sign-in/email \
#       -H 'Content-Type: application/json' \
#       -d '{"email":"akshatpatel99812@gmail.com","password":"YOUR_PASSWORD"}' >/dev/null
#     export WPI_COOKIE="wpi.session_token=$(awk '/wpi.session_token/{print $7}' /tmp/wpi.cookies)"
#
#   ...then:  bash MIGRATION/golden/capture.sh
#
# Env: API (default http://localhost:3005), WPI_COOKIE (required), or COOKIE_JAR=/tmp/wpi.cookies.
set -euo pipefail

API="${API:-http://localhost:3005}"
DIR="$(cd "$(dirname "$0")" && pwd)"

auth_args=()
if [[ -n "${WPI_COOKIE:-}" ]]; then
  auth_args=(-H "Cookie: ${WPI_COOKIE}")
elif [[ -n "${COOKIE_JAR:-}" && -f "${COOKIE_JAR}" ]]; then
  auth_args=(-b "${COOKIE_JAR}")
else
  echo "ERROR: set WPI_COOKIE='wpi.session_token=...' or COOKIE_JAR=/path/cookies (see header)." >&2
  exit 2
fi

# Coverage matrix: name | description | request body. Real Indian AOIs + degraded/error paths.
# Point-mode squares (~5x5km) match the engine's squareRingAround fingerprint (isPointMode=true).
read -r -d '' AOIS <<'EOF' || true
excellent_muppandal_point|excellent class, point-mode, mast+grid present|{"geometry":{"type":"Polygon","coordinates":[[[77.527308,8.237391],[77.572692,8.237391],[77.572692,8.282609],[77.527308,8.282609],[77.527308,8.237391]]]}}
marginal_bhadla_point|marginal class, point-mode (low wind, solar belt)|{"geometry":{"type":"Polygon","coordinates":[[[71.894677,27.507391],[71.945323,27.507391],[71.945323,27.552609],[71.894677,27.552609],[71.894677,27.507391]]]}}
moderate_interior_tn|drawn polygon, interior Tamil Nadu plateau|{"geometry":{"type":"Polygon","coordinates":[[[78.05,10.85],[78.18,10.85],[78.18,10.98],[78.05,10.98],[78.05,10.85]]]}}
large_aoi_tn|~1900 km2 (near AOI_MAX 2500), multi-tile stitch|{"geometry":{"type":"Polygon","coordinates":[[[78.0,10.8],[78.4,10.8],[78.4,11.2],[78.0,11.2],[78.0,10.8]]]}}
tiny_aoi|~1.1 km2 (near AOI_MIN 1), single-pixel-ish|{"geometry":{"type":"Polygon","coordinates":[[[78.1,11.0],[78.1095,11.0],[78.1095,11.0095],[78.1,11.0095],[78.1,11.0]]]}}
ocean_nodata|Arabian Sea: all-nodata -> resource section unavailable|{"geometry":{"type":"Polygon","coordinates":[[[69.8,13.8],[70.2,13.8],[70.2,14.2],[69.8,14.2],[69.8,13.8]]]}}
err_out_of_india|400 OUT_OF_INDIA (vertex lon>98)|{"geometry":{"type":"Polygon","coordinates":[[[99.0,20.0],[99.1,20.0],[99.1,20.1],[99.0,20.1],[99.0,20.0]]]}}
err_area_too_large|400 AREA_TOO_LARGE (~1deg box >2500 km2)|{"geometry":{"type":"Polygon","coordinates":[[[78.0,11.0],[79.0,11.0],[79.0,12.0],[78.0,12.0],[78.0,11.0]]]}}
err_self_intersecting|400 SELF_INTERSECTING (bowtie)|{"geometry":{"type":"Polygon","coordinates":[[[78.0,11.0],[78.1,11.1],[78.1,11.0],[78.0,11.1],[78.0,11.0]]]}}
err_area_too_small|400 AREA_TOO_SMALL (~0.1 km2)|{"geometry":{"type":"Polygon","coordinates":[[[78.1,11.0],[78.103,11.0],[78.103,11.003],[78.1,11.003],[78.1,11.0]]]}}
EOF

echo "API=$API   (climate flag should be OFF for default-parity)"
while IFS='|' read -r name desc body; do
  [[ -z "$name" ]] && continue
  d="$DIR/$name"; mkdir -p "$d"
  printf '%s' "$body" > "$d/request.json"
  echo "$desc" > "$d/description.txt"
  # MISS then HIT: the HIT body must byte-match the MISS body (cache round-trip parity).
  for pass in miss hit; do
    code=$(curl -s -X POST "$API/api/analyze" \
      -H 'Content-Type: application/json' "${auth_args[@]}" \
      -d @"$d/request.json" \
      -o "$d/response.$pass.json" -D "$d/headers.$pass.txt" -w '%{http_code}')
    cache=$(awk -F': ' 'tolower($1)=="x-analysis-cache"{gsub(/\r/,"",$2);print $2}' "$d/headers.$pass.txt")
    printf '  %-26s [%s] -> %s  cache=%s\n' "$name" "$pass" "$code" "${cache:-none}"
  done
  cp "$d/response.hit.json" "$d/response.json"
  shasum -a 256 "$d/response.json" | awk '{print $1}' > "$d/response.sha256"
  # Sanity: MISS and HIT bodies identical?
  if ! cmp -s "$d/response.miss.json" "$d/response.hit.json"; then
    echo "    !! WARNING: MISS and HIT bodies differ for $name (investigate)"
  fi
done <<< "$AOIS"

echo
echo "Done. Fixtures under $DIR/<name>/{request.json,response.json,response.sha256}."
echo "Note: error_* cases return 401 (not their 400 code) if WPI_COOKIE is missing/expired."
