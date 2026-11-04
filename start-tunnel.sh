#!/usr/bin/env sh
# Always run from the folder this file lives in, so the config is found.
cd "$(dirname "$0")" || exit 1

if [ ! -f mcp-local-tunnel.config.json ]; then
  echo "[ERROR] mcp-local-tunnel.config.json was not found in $(pwd)"
  exit 1
fi

# Check the config is valid JSON before launching.
if ! node -e "JSON.parse(require('fs').readFileSync('mcp-local-tunnel.config.json','utf8'))" 2>/dev/null; then
  echo "[ERROR] mcp-local-tunnel.config.json is not valid JSON."
  echo "Check for stray backslashes, missing commas, or unquoted values."
  exit 1
fi

echo "Starting MCP Local Tunnel agent..."
npx -y mcp-local-tunnel
echo "Logs: $HOME/.config/mcp-local-tunnel/logs"
