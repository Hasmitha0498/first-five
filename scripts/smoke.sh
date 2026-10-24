#!/usr/bin/env bash
# Read-only smoke test for a deployed First Five instance (creates no accounts or data,
# so production activity counts stay genuine).
#   bash scripts/smoke.sh https://first-five.onrender.com
set -euo pipefail
BASE="${1:?usage: smoke.sh <base-url>}"
fail=0
check() {
  local name="$1" url="$2" expect="$3"
  local body code
  body=$(curl -sS --max-time 90 -w '\n%{http_code}' "$url") || { echo "FAIL $name (request error)"; fail=1; return; }
  code="${body##*$'\n'}"; body="${body%$'\n'*}"
  if [[ "$code" == 200* ]] && grep -q "$expect" <<<"$body"; then echo "PASS $name"; else echo "FAIL $name (HTTP $code)"; fail=1; fi
}
check "healthz"        "$BASE/healthz"              '"status":"ok"'
check "readyz (db)"    "$BASE/readyz"               '"database":"ok"'
check "landing page"   "$BASE/"                     '<div id="root">'
check "sample report"  "$BASE/sample-report"        '<div id="root">'
check "waitlist page"  "$BASE/waitlist"             '<div id="root">'
check "access page"    "$BASE/access"               '<div id="root">'
check "offer API"      "$BASE/api/billing/offer"    '"key":"single_study"'
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/projects"); [[ "$code" == 401 ]] && echo "PASS auth required" || { echo "FAIL auth required ($code)"; fail=1; }
hdr=$(curl -sI "$BASE/" | tr -d '\r'); grep -qi '^content-security-policy:' <<<"$hdr" && echo "PASS CSP header" || { echo "FAIL CSP header"; fail=1; }
exit $fail
