#!/usr/bin/env bash
# Start the server on a disposable copy of data/config, so a driver can edit freely and
# never touch the real programme files. Prints nothing but the port it came up on.
set -u
PORT="${UNMARKABLE_PORT:-8084}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIVE="${UNMARKABLE_LIVE:-$ROOT/target/editor-drive}"

# WAIT FOR THE PORT TO BE FREE, rather than killing and sleeping a second.
#
# A second is usually enough and when it is not the failure is baffling: the new server cannot
# bind, so the driver talks to the OLD one — whose data root this script has just deleted and
# re-copied underneath it. What comes back is then a 404 for a race that was certainly written,
# which reads as a bug in the thing under test. Seen, and it cost an hour.
PID=$(ss -ltnp 2>/dev/null | grep ":$PORT" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
if [ -n "$PID" ]; then
  kill "$PID" 2>/dev/null
  for _ in $(seq 1 30); do
    ss -ltn 2>/dev/null | grep -q ":$PORT " || break
    sleep 0.5
  done
  # Still holding it after fifteen seconds: it is not going to let go politely.
  ss -ltn 2>/dev/null | grep -q ":$PORT " && kill -9 "$PID" 2>/dev/null
  sleep 0.5
fi

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
