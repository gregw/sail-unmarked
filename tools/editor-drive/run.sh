#!/usr/bin/env bash
# Every driver, each against a freshly copied config so they cannot contaminate each other.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
total=0; bad=0
for d in "$HERE"/drive-*.mjs; do
  "$HERE/serve.sh" > /dev/null
  out=$(node "$d" 2>&1)
  line=$(echo "$out" | tail -1)
  printf '%-28s %s\n' "$(basename "$d" .mjs)" "$line"
  echo "$out" | grep FAIL | sed 's/^/    /'
  total=$((total + $(echo "$line" | sed -n 's/^\([0-9]*\) passed.*/\1/p')))
  bad=$((bad + $(echo "$line" | sed -n 's/.*, \([0-9]*\) failed$/\1/p')))
done
PID=$(ss -ltnp 2>/dev/null | grep ':8084' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
[ -n "$PID" ] && kill "$PID"
echo "TOTAL $total passed, $bad failed"
[ "$bad" = "0" ]
