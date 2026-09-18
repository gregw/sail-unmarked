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
  # A driver that DIED rather than reporting counts as a failure rather than as nothing. Its
  # last line is then a stack trace, which parses to no number at all — and the arithmetic
  # below used to fail on the empty string, print a shell syntax error, and abandon the rest of
  # the suite with a TOTAL that looked like a pass.
  passed=$(echo "$line" | sed -n 's/^\([0-9]*\) passed.*/\1/p')
  failed=$(echo "$line" | sed -n 's/.*, \([0-9]*\) failed$/\1/p')
  if [ -z "$passed" ]; then
    echo "    DIED — no report; last line was: $line"
    echo "$out" | tail -12 | sed 's/^/    /'
    passed=0
    failed=1
  fi
  total=$((total + passed))
  bad=$((bad + failed))
done
PID=$(ss -ltnp 2>/dev/null | grep ':8084' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
[ -n "$PID" ] && kill "$PID"
echo "TOTAL $total passed, $bad failed"
[ "$bad" = "0" ]
