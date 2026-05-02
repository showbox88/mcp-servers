#!/bin/bash
# mcp-servers deploy script (smart-trip MCP).
#
# Runs as root (via sudo). Build steps drop privileges to `mcp` user.
#
# Invoked by Claude Code via:
#   ssh showbox@vm 'sudo /opt/mcp-servers/deploy.sh'
#
# Sudoers grants showbox NOPASSWD only for THIS exact path:
#   showbox ALL=(root) NOPASSWD: /opt/mcp-servers/deploy.sh
set -euo pipefail

REPO_DIR=/opt/mcp-servers
SERVICE=smart-trip-mcp
HEALTH_URL=http://127.0.0.1:3001/healthz

if [ "$(id -u)" -ne 0 ]; then
  echo "deploy.sh: must be invoked via sudo" >&2
  exit 1
fi

cd "$REPO_DIR"

echo "==> [mcp-servers] git pull"
runuser -u mcp -- git pull --ff-only

# smart-trip is the only MCP we deploy from this repo for now
cd smart-trip

echo "==> [smart-trip] npm install (only changed deps)"
runuser -u mcp -- npm install --silent --no-audit --no-fund

echo "==> [smart-trip] npm run build"
runuser -u mcp -- npm run build

echo "==> [smart-trip] systemctl restart $SERVICE"
systemctl restart "$SERVICE"

# Wait for service to come up, then probe health
for i in 1 2 3 4 5; do
  sleep 1
  if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "==> [smart-trip] health OK after ${i}s"
    curl -s -m 3 "$HEALTH_URL"
    echo
    echo "==> [smart-trip] done"
    exit 0
  fi
done

echo "==> [smart-trip] health check FAILED — check journalctl -u $SERVICE" >&2
exit 1
