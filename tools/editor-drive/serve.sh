#!/usr/bin/env bash
# Start the server on a disposable copy of data/config, so a driver can edit freely and
# never touch the real programme files. Prints nothing but the port it came up on.
set -u
PORT="${UNMARKABLE_PORT:-8084}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIVE="${UNMARKABLE_LIVE:-$ROOT/target/editor-drive}"

PID=$(ss -ltnp 2>/dev/null | grep ":$PORT" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
[ -n "$PID" ] && { kill "$PID"; sleep 1; }

rm -rf "$LIVE"
mkdir -p "$LIVE"
cp -r "$ROOT/data/config" "$LIVE/"
sed -i "s/port: 8083/port: $PORT/" "$LIVE/config/config.yaml"

cd "$ROOT"
nohup mvn --batch-mode exec:java -Dunmarkable-data="$LIVE" > "$LIVE/server.log" 2>&1 &
for _ in $(seq 1 40); do
  curl -sf "localhost:$PORT/api/config" > /dev/null 2>&1 && break
  sleep 1
done
echo "$PORT"
