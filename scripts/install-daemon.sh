#!/usr/bin/env bash
#
# Install crypto-agent as a user-level systemd service.
# Requires: systemd --user (Linux). Does NOT need root.
#
# Usage:
#   ./scripts/install-daemon.sh               # install and enable
#   ./scripts/install-daemon.sh --no-enable   # install only, don't enable
#   ./scripts/install-daemon.sh --start       # also start immediately
#
set -euo pipefail

# ─── Paths ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$PROJECT_DIR/systemd/crypto-agent.service.template"

SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SERVICE_NAME="crypto-agent.service"
TARGET="$SYSTEMD_USER_DIR/$SERVICE_NAME"

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/crypto-agent"

# ─── Parse flags ────────────────────────────────────────────────────────────

ENABLE_SERVICE=1
START_SERVICE=0
for arg in "$@"; do
  case "$arg" in
    --no-enable) ENABLE_SERVICE=0 ;;
    --start)     START_SERVICE=1 ;;
    -h|--help)
      sed -n '3,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 1
      ;;
  esac
done

# ─── Sanity checks ──────────────────────────────────────────────────────────

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "❌ 'node' not found on PATH. Install Node.js first (nvm / apt / ...)." >&2
  exit 1
fi

if [[ ! -f "$TEMPLATE" ]]; then
  echo "❌ Template not found: $TEMPLATE" >&2
  exit 1
fi

if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo "⚠️  $PROJECT_DIR/.env not found."
  echo "   The service requires .env — copy from .env.example and fill in your keys."
  exit 1
fi

if [[ ! -d "$PROJECT_DIR/dist" ]]; then
  echo "Building project (dist/ missing)..."
  (cd "$PROJECT_DIR" && npm run build)
fi

# Check systemd --user is available
if ! systemctl --user --version > /dev/null 2>&1; then
  echo "❌ systemd --user is not available on this system." >&2
  echo "   This script requires a Linux system with a running user session bus." >&2
  echo "   If you're on WSL, ensure systemd is enabled in /etc/wsl.conf." >&2
  exit 1
fi

# ─── Install ────────────────────────────────────────────────────────────────

mkdir -p "$SYSTEMD_USER_DIR"
mkdir -p "$STATE_DIR"

echo "→ Rendering service file"
echo "  Node:        $NODE_BIN"
echo "  Project:     $PROJECT_DIR"
echo "  State dir:   $STATE_DIR"
echo "  Destination: $TARGET"

sed \
  -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  -e "s|__STATE_DIR__|$STATE_DIR|g" \
  "$TEMPLATE" > "$TARGET"

echo "→ Reloading systemd"
systemctl --user daemon-reload

if [[ "$ENABLE_SERVICE" -eq 1 ]]; then
  echo "→ Enabling service (will start at login)"
  systemctl --user enable "$SERVICE_NAME"
fi

if [[ "$START_SERVICE" -eq 1 ]]; then
  echo "→ Starting service"
  systemctl --user start "$SERVICE_NAME"
  sleep 1
  systemctl --user --no-pager status "$SERVICE_NAME" | head -12
fi

cat <<EOF

✓ Installation complete.

Common commands:
  systemctl --user start   crypto-agent
  systemctl --user stop    crypto-agent
  systemctl --user restart crypto-agent
  systemctl --user status  crypto-agent

Logs:
  journalctl --user -u crypto-agent -f        # live (if journald captures it)
  tail -f $STATE_DIR/daemon.log
  tail -f $STATE_DIR/daemon.err

To survive logout (run without being signed in):
  sudo loginctl enable-linger \$USER

To remove:
  ./scripts/uninstall-daemon.sh
EOF
