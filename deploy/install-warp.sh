#!/usr/bin/env bash
# Install Cloudflare WARP and put zen-proxy's upstream calls through it.
#
#   sudo bash deploy/install-warp.sh            # install
#   sudo bash deploy/install-warp.sh --remove   # undo
#
# What --install does:
#   1. installs the official cloudflare-warp package (apt, trixie/bookworm/bullseye)
#   2. registers a free WARP device and puts the client in proxy mode
#      (127.0.0.1:40000, no change to the host's routing)
#   3. installs the relay unit and the zen-proxy drop-in, then restarts both
#
# What --remove does:
#   removes the drop-in and the relay unit, restarts zen-proxy, and uninstalls
#   the WARP package and its device registration
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
RELAY_PORT="${RELAY_PORT:-8890}"
WARP_PROXY_PORT="${WARP_PROXY_PORT:-40000}"
HOP="http://127.0.0.1:${WARP_PROXY_PORT}"
RELAY_URL="http://127.0.0.1:${RELAY_PORT}"

info() { printf '\033[32m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

MODE="install"
for arg in "$@"; do
  case "$arg" in
    --remove) MODE="remove" ;;
    --install) MODE="install" ;;
    *) die "unknown option: $arg" ;;
  esac
done

command -v node >/dev/null 2>&1 || die "Node.js >= 18 is required."
SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"

remove_all() {
  echo "== removing the hop =="
  $SUDO systemctl disable --now zen-proxy-warp-relay 2>/dev/null || true
  $SUDO rm -f /etc/systemd/system/zen-proxy-warp-relay.service
  $SUDO rm -f /etc/systemd/system/zen-proxy.service.d/warp-proxy.conf
  $SUDO rmdir /etc/systemd/system/zen-proxy.service.d 2>/dev/null || true
  $SUDO systemctl daemon-reload
  $SUDO systemctl restart zen-proxy
  if command -v warp-cli >/dev/null 2>&1; then
    warp-cli --accept-tos disconnect 2>/dev/null || true
    warp-cli --accept-tos registration delete 2>/dev/null || true
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get remove -y cloudflare-warp || true
    $SUDO rm -f /etc/apt/sources.list.d/cloudflare-client.list
    $SUDO rm -f /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
  fi
  info "hop removed; zen-proxy talks to the upstream directly again"
}

if [ "$MODE" = "remove" ]; then
  remove_all
  exit 0
fi

[ -f "$REPO_DIR/scripts/warp-relay.mjs" ] || die "scripts/warp-relay.mjs not found in $REPO_DIR"

echo "== 1. Cloudflare WARP package =="
CODENAME=$(. /etc/os-release; echo "${VERSION_CODENAME}")
if ! command -v warp-cli >/dev/null 2>&1; then
  curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
    | $SUDO gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $CODENAME main" \
    | $SUDO tee /etc/apt/sources.list.d/cloudflare-client.list >/dev/null
  $SUDO apt-get update
  # --no-install-recommends keeps the dependency set to what WARP actually needs.
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends cloudflare-warp
  info "cloudflare-warp installed"
else
  info "warp-cli already installed"
fi

echo "== 2. register and proxy mode =="
# The WARP client asks for the Cloudflare terms to be accepted; --accept-tos
# answers that on your behalf. Registering a device is an account action: run
# it yourself if you would rather see the prompt.
warp-cli --accept-tos registration new 2>&1 | sed 's/^/  /' || true
warp-cli --accept-tos mode proxy 2>&1 | sed 's/^/  /'
warp-cli --accept-tos connect 2>&1 | sed 's/^/  /'
sleep 5
warp-cli --accept-tos status 2>&1 | sed 's/^/  /'

echo "== 3. relay unit + zen-proxy drop-in =="
$SUDO mkdir -p /etc/systemd/system/zen-proxy.service.d
sed -e "s|--port 8890|--port ${RELAY_PORT}|" -e "s|--hop http://127.0.0.1:40000|--hop ${HOP}|" \
  "$REPO_DIR/deploy/zen-proxy-warp-relay.service" \
  | $SUDO tee /etc/systemd/system/zen-proxy-warp-relay.service >/dev/null
sed -e "s|http://127.0.0.1:40000|${HOP}|g" \
  "$REPO_DIR/deploy/zen-proxy.service.d/warp-proxy.conf" \
  | $SUDO tee /etc/systemd/system/zen-proxy.service.d/warp-proxy.conf >/dev/null

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now zen-proxy-warp-relay
$SUDO systemctl restart zen-proxy
sleep 4

echo "== 4. verify =="
systemctl is-active zen-proxy-warp-relay | sed 's/^/  relay: /'
systemctl is-active zen-proxy | sed 's/^/  zen-proxy: /'
printf "  relay status: "; curl -s --max-time 5 "${RELAY_URL}/__status" || echo "(no answer)"
echo
printf "  exit through the relay: "; curl -s --max-time 30 -x "${RELAY_URL}" https://cloudflare.com/cdn-cgi/trace \
  | grep -E '^(ip|loc|colo|warp)=' | tr '\n' ' '; echo
printf "  zen-proxy health: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://127.0.0.1:8787/health
echo
info "Done. The upstream now leaves the host through WARP; /api/status reports the hop."
info "Undo: sudo bash deploy/install-warp.sh --remove"
