#!/usr/bin/env bash
#
# Remove the crypto-agent user-level systemd service.
# Leaves .env, logs, and SQLite memory untouched.
#
set -euo pipefail

SERVICE_NAME="crypto-agent.service"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
TARGET="$SYSTEMD_USER_DIR/$SERVICE_NAME"

if ! systemctl --user --version > /dev/null 2>&1; then
  echo "systemd --user not available — nothing to uninstall." >&2
  exit 0
fi

if systemctl --user is-active --quiet "$SERVICE_NAME"; then
  echo "→ Stopping $SERVICE_NAME"
  systemctl --user stop "$SERVICE_NAME"
fi

if systemctl --user is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
  echo "→ Disabling $SERVICE_NAME"
  systemctl --user disable "$SERVICE_NAME"
fi

if [[ -f "$TARGET" ]]; then
  echo "→ Removing $TARGET"
  rm -f "$TARGET"
fi

systemctl --user daemon-reload

echo "✓ Uninstalled. Logs and data were left intact:"
echo "  ${XDG_STATE_HOME:-$HOME/.local/state}/crypto-agent/"
