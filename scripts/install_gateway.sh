#!/usr/bin/env bash
# Install Friday-OS Python Gateway as a systemd user service.
# Auto-starts on login, runs 24/7 in background.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_FILE="$SCRIPT_DIR/friday-gateway.service"
SYSTEMD_DIR="$HOME/.config/systemd/user"

echo "═══════════════════════════════════════════"
echo "  Friday-OS Gateway — Systemd Installer"
echo "═══════════════════════════════════════════"

# 1. Verify gateway.py exists
GATEWAY_PY="$(dirname "$SCRIPT_DIR")/core_engine/gateway.py"
if [ ! -f "$GATEWAY_PY" ]; then
    echo "❌ gateway.py not found at $GATEWAY_PY"
    exit 1
fi

# 2. Quick dry-run to verify imports
echo "• Verifying Python imports..."
/home/gopi/.venv/bin/python "$GATEWAY_PY" --dry-run || {
    echo "❌ Dry run failed. Check dependencies."
    exit 1
}

# 3. Install systemd unit
mkdir -p "$SYSTEMD_DIR"
cp "$SERVICE_FILE" "$SYSTEMD_DIR/friday-gateway.service"
echo "• Installed service to $SYSTEMD_DIR/friday-gateway.service"

# 4. Reload, enable, start
systemctl --user daemon-reload
systemctl --user enable friday-gateway.service
systemctl --user start friday-gateway.service

echo ""
echo "✅ Friday-OS Gateway installed and running!"
echo ""
echo "Useful commands:"
echo "  systemctl --user status friday-gateway"
echo "  journalctl --user -u friday-gateway -f"
echo "  systemctl --user restart friday-gateway"
echo "  systemctl --user stop friday-gateway"
echo "  curl http://127.0.0.1:8001/health"
echo ""
