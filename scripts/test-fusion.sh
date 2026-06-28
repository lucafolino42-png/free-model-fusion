#!/usr/bin/env bash
# scripts/test-fusion.sh -- End-to-end model fusion pipeline test

set -euo pipefail

PORT="${PORT:-3000}"
BASE="http://localhost:${PORT}"
AUTO_START=false
VERBOSE=false
EXIT_CODE=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start|-s)   AUTO_START=true; shift ;;
    --port|-p)    PORT="$2"; BASE="http://localhost:${PORT}"; shift 2 ;;
    --verbose|-v) VERBOSE=true; shift ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo "  --start,-s     Auto-start server"
      echo "  --port,-p N    Port (default: 3000)"
      echo "  --verbose,-v   Show curl responses"
      exit 0 ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
pass()    { echo -e "  ${GREEN}OK${NC} $*"; }
fail()    { echo -e "  ${RED}FAIL${NC} $*"; EXIT_CODE=1; }
warn()    { echo -e "  ${YELLOW}WARN${NC} $*"; }
header()  { echo ""; echo -e "${BOLD}--- $* ---${NC}"; }

run_curl() {
  local d="$1"; local a="$2"
  [ "$VERBOSE" = true ] && { echo ""; info "curl $a"; }
  local r; r=$(curl -s -w "\n%{http_code}" $a 2>&1 || true)
  local c; c=$(echo "$r" | tail -1)
  local b; b=$(echo "$r" | sed '$d')
  [ "$VERBOSE" = true ] && { echo "$b" | head -c 2000; echo ""; }
  [ "$c" != "200" ] && { fail "$d - HTTP $c"; return 1; }
  echo "$b"; return 0
}

check_fusion() {
  local b="$1"; local l="$2"
  echo "$b" | python3 -c "import json,sys;d=json.loads(sys.stdin.read());assert'answer'in d;assert'meta'in d" 2>/dev/null || { fail "$l: bad response"; return 1; }
  local v; v=$(echo "$b" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read());m=d['meta'];r=m['routing']
print(f'EU={r[\"expertsUsed\"]}')
print(f'JU={str(r[\"judgeUsed\"]).lower()}')
print(f'SU={str(r[\"synthesisUsed\"]).lower()}')
print(f'ML={\",\".join(m[\"models\"].get(\"experts\",[]))}')
print(f'SI={m[\"memory\"][\"sessionId\"]}')
print(f'TK={m[\"tokens\"][\"totalEstimated\"]}')
print(f'AL={len(d[\"answer\"])}')")
  local EU JU SU ML SI TK AL; while IFS='=' read -r k v2; do
    case "$k" in EU) EU="$v2" ;; JU) JU="$v2" ;; SU) SU="$v2" ;; ML) ML="$v2" ;;
      SI) SI="$v2" ;; TK) TK="$v2" ;; AL) AL="$v2" ;; esac
  done <<< "$v"
  [ "$EU" -gt 0 ] 2>/dev/null && pass "$l: $EU expert(s)" || { fail "$l: 0 experts"; return 1; }
  [ "$JU" = "true" ] && pass "$l: judge used" || warn "$l: no judge"
  [ "$SU" = "true" ] && pass "$l: synthesis used" || { fail "$l: no synthesis"; return 1; }
  [ -n "$ML" ] && pass "$l: models: $(echo $ML | head -c 60)..." || { fail "$l: no models"; return 1; }
  [ -n "$SI" ] && pass "$l: session: $(echo $SI | head -c 12)..."
  [ "$TK" -gt 0 ] 2>/dev/null && pass "$l: tokens: $TK"
  [ "$AL" -gt 0 ] 2>/dev/null && pass "$l: answer: ${AL} chars" || { fail "$l: empty answer"; return 1; }
}

start_srv() {
  curl -sf "${BASE}/health" >/dev/null 2>&1 && { info "Server running"; return 0; }
  [ "$AUTO_START" = false ] && { info "Start: npm run dev"; exit 1; }
  info "Starting server..."
  npm run dev & SPID=$!
  local w=0; while ! curl -sf "${BASE}/health" >/dev/null 2>&1 && [ $w -lt 15 ]; do sleep 1; w=$((w+1)); done
  curl -sf "${BASE}/health" >/dev/null 2>&1 && pass "Server started (PID $SPID)" || { fail "Start failed"; exit 1; }
}

echo ""
echo -e "${BOLD}=== Free Model Fusion - Pipeline Test Suite ===${NC}"
echo "Server: ${BASE}"
echo "Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
start_srv

header "1. Health"
H=$(run_curl "Health" "-X GET ${BASE}/health")
[ $? -eq 0 ] && { S=$(echo "$H" | python3 -c "import json,sys;print(json.loads(sys.stdin.read()).get('status','?'))" 2>/dev/null); [ "$S" = "ok" ] && pass "Status: $S" || fail "Bad: $S"; }
echo ""

header "2. Speed Profile"
R=$(run_curl "Speed" "-X POST ${BASE}/chat -H 'Content-Type: application/json' -d '{"message":"What is 2+2?","profile":"speed"}'")
[ $? -eq 0 ] && check_fusion "$R" "Speed"
echo ""

header "3. Balanced Profile"
R=$(run_curl "Balanced" "-X POST ${BASE}/chat -H 'Content-Type: application/json' -d '{"message":"Explain fusion pipeline in one sentence.","profile":"balanced"}'")
[ $? -eq 0 ] && check_fusion "$R" "Balanced"
echo ""

header "4. Quality Profile"
R=$(run_curl "Quality" "-X POST ${BASE}/chat -H 'Content-Type: application/json' -d '{"message":"List 3 benefits of multi-model AI.","profile":"quality"}'")
[ $? -eq 0 ] && check_fusion "$R" "Quality"
echo ""

header "5. Session Memory"
SID="test-session-$(date +%s)"
echo -e "  ${CYAN}Session:${NC} $SID"
R1=$(run_curl "Turn1" "-X POST ${BASE}/chat -H 'Content-Type: application/json' -d '{"message":"My favorite number is 42.","sessionId":"'"$SID"'","profile":"speed"}'")
[ $? -eq 0 ] && check_fusion "$R1" "Turn1"
R2=$(run_curl "Turn2" "-X POST ${BASE}/chat -H 'Content-Type: application/json' -d '{"message":"What is my favorite number?","sessionId":"'"$SID"'","profile":"speed"}'")
if [ $? -eq 0 ]; then
  check_fusion "$R2" "Turn2"
  LD=$(echo "$R2" | python3 -c "import json,sys;print(json.loads(sys.stdin.read())['meta']['memory']['messagesLoaded'])" 2>/dev/null)
  [ "$LD" -gt 0 ] 2>/dev/null && pass "Memory: $LD msgs" || warn "No memory loaded"
  ANS=$(echo "$R2" | python3 -c "import json,sys;print(json.loads(sys.stdin.read()).get('answer',''))" 2>/dev/null)
  echo "$ANS" | grep -iq "42" && pass "Remembers 42" || warn "No 42 reference"
fi
echo ""

header "6. Web Search"
R=$(run_curl "Web" "-X POST ${BASE}/chat -H 'Content-Type: application/json' -d '{"message":"Latest AI news 2026","profile":"balanced","web":"on"}'")
if [ $? -eq 0 ]; then
  check_fusion "$R" "Web"
  SR=$(echo "$R" | python3 -c "import json,sys;print(json.loads(sys.stdin.read())['meta']['web']['searched'])" 2>/dev/null)
  [ "$SR" = "True" ] && pass "Web searched" || warn "No web search (need TAVILY_API_KEY)"
fi
echo ""

header "7. Empty Message (400 expected)"
EC=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/chat" -H "Content-Type: application/json" -d '{"message":""}' 2>/dev/null || true)
[ "$EC" != "200" ] && pass "Empty: HTTP $EC (non-200)" || warn "Empty: HTTP 200"
echo ""

header "8. Missing Message (400 expected)"
MC=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/chat" -H "Content-Type: application/json" -d '{}' 2>/dev/null || true)
[ "$MC" != "200" ] && pass "Missing: HTTP $MC (non-200)" || warn "Missing: HTTP 200"
echo ""

header "9. Commands"
MA=$(curl -s -X POST "${BASE}/chat" -H "Content-Type: application/json" -d '{"message":"/models"}' 2>/dev/null | python3 -c "import json,sys;print(json.loads(sys.stdin.read()).get('answer',''))" 2>/dev/null)
echo "$MA" | grep -iq "model\|available" && pass "/models OK" || warn "/models: ${MA:0:50}"
PA=$(curl -s -X POST "${BASE}/chat" -H "Content-Type: application/json" -d '{"message":"/providers"}' 2>/dev/null | python3 -c "import json,sys;print(json.loads(sys.stdin.read()).get('answer',''))" 2>/dev/null)
echo "$PA" | grep -iq "provider\|available" && pass "/providers OK" || warn "/providers: ${PA:0:50}"
echo ""

echo -e "${BOLD}=== RESULT ===${NC}"
[ "$EXIT_CODE" -eq 0 ] && echo -e "  ${GREEN}${BOLD}ALL TESTS PASSED${NC}" || echo -e "  ${RED}${BOLD}SOME TESTS FAILED${NC}"
echo ""

[ -n "${SPID:-}" ] && kill "$SPID" 2>/dev/null && info "Server stopped"
exit "$EXIT_CODE"
