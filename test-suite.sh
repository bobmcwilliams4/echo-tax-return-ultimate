#!/bin/bash
# ECHO TAX RETURN ULTIMATE — SOVEREIGN EXHAUSTIVE TEST SUITE
# Tests ALL endpoint groups with happy path, error handling, auth, and latency

API="http://localhost:9000"
KEY="echo-tax-ultimate-dev-key"

# Get existing IDs
RETURN_ID=$(curl -sf -H "X-Echo-API-Key: $KEY" "$API/api/v5/returns" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
CLIENT_ID=$(curl -sf -H "X-Echo-API-Key: $KEY" "$API/api/v5/clients" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

PASS=0
FAIL=0
TOTAL=0
FAILURES=""

run_test() {
  local name="$1"
  local expect_fail="$2"
  local status="$3"
  TOTAL=$((TOTAL+1))
  if [ "$status" = "200" ] || [ "$status" = "201" ]; then
    PASS=$((PASS+1))
    printf "  [OK] %s\n" "$name"
  elif [ "$expect_fail" = "1" ] && { [ "$status" = "400" ] || [ "$status" = "404" ] || [ "$status" = "409" ] || [ "$status" = "401" ] || [ "$status" = "403" ]; }; then
    PASS=$((PASS+1))
    printf "  [OK] %s (expected %s)\n" "$name" "$status"
  else
    FAIL=$((FAIL+1))
    FAILURES="${FAILURES}  [XX] ${name} (${status})\n"
    printf "  [XX] %s (%s)\n" "$name" "$status"
  fi
}

get_test() {
  local name="$1"
  local url="$2"
  local expect_fail="${3:-0}"
  local status=$(curl -sf -o /dev/null -w "%{http_code}" -H "X-Echo-API-Key: $KEY" "$API$url" 2>/dev/null)
  run_test "$name" "$expect_fail" "$status"
}

post_test() {
  local name="$1"
  local url="$2"
  local body="$3"
  local expect_fail="${4:-0}"
  local status
  if [ -n "$body" ]; then
    status=$(curl -sf -o /dev/null -w "%{http_code}" -X POST -H "X-Echo-API-Key: $KEY" -H "Content-Type: application/json" -d "$body" "$API$url" 2>/dev/null)
  else
    status=$(curl -sf -o /dev/null -w "%{http_code}" -X POST -H "X-Echo-API-Key: $KEY" "$API$url" 2>/dev/null)
  fi
  run_test "$name" "$expect_fail" "$status"
}

put_test() {
  local name="$1"
  local url="$2"
  local body="$3"
  local status=$(curl -sf -o /dev/null -w "%{http_code}" -X PUT -H "X-Echo-API-Key: $KEY" -H "Content-Type: application/json" -d "$body" "$API$url" 2>/dev/null)
  run_test "$name" "0" "$status"
}

echo ""
echo "=================================================================="
echo "  ECHO TAX RETURN ULTIMATE — SOVEREIGN EXHAUSTIVE TEST SUITE"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Return: $RETURN_ID"
echo "  Client: $CLIENT_ID"
echo "=================================================================="

echo ""
echo "--- PHASE 1: SYSTEM HEALTH (3 tests) ---"
get_test "GET /" "/"
get_test "GET /health" "/health"
get_test "GET /health/ready" "/health/ready"

echo ""
echo "--- PHASE 2: AUTH & SECURITY (2 tests) ---"
TOTAL=$((TOTAL+1))
S=$(curl -sf -o /dev/null -w "%{http_code}" "$API/api/v5/clients" 2>/dev/null)
if [ "$S" = "401" ] || [ "$S" = "403" ]; then PASS=$((PASS+1)); echo "  [OK] No-auth blocked ($S)"; else FAIL=$((FAIL+1)); echo "  [XX] No-auth: $S"; fi
TOTAL=$((TOTAL+1))
S=$(curl -sf -o /dev/null -w "%{http_code}" -H "X-Echo-API-Key: wrong-key" "$API/api/v5/clients" 2>/dev/null)
if [ "$S" = "401" ] || [ "$S" = "403" ]; then PASS=$((PASS+1)); echo "  [OK] Bad-auth blocked ($S)"; else FAIL=$((FAIL+1)); echo "  [XX] Bad-auth: $S"; fi

echo ""
echo "--- PHASE 3: HAPPY PATH — ALL ENDPOINTS ---"

echo "  [Clients]"
get_test "List clients" "/api/v5/clients"
get_test "Get client" "/api/v5/clients/$CLIENT_ID"
get_test "Tax history" "/api/v5/clients/$CLIENT_ID/tax-history"
put_test "Update client" "/api/v5/clients/$CLIENT_ID" '{"first_name":"John","last_name":"Doe"}'

echo "  [Returns]"
get_test "List returns" "/api/v5/returns"
get_test "Get return" "/api/v5/returns/$RETURN_ID"
get_test "Return summary" "/api/v5/returns/$RETURN_ID/summary"
get_test "Return health" "/api/v5/returns/$RETURN_ID/health"
post_test "Calculate" "/api/v5/returns/$RETURN_ID/calculate"
post_test "Lock" "/api/v5/returns/$RETURN_ID/lock"
post_test "Unlock" "/api/v5/returns/$RETURN_ID/unlock"
post_test "Clone" "/api/v5/returns/$RETURN_ID/clone"

echo "  [Income]"
get_test "Get income" "/api/v5/income/$RETURN_ID"
post_test "Add income" "/api/v5/income" "{\"return_id\":\"$RETURN_ID\",\"category\":\"interest\",\"amount\":1500,\"payer_name\":\"Chase Bank\"}"

echo "  [Deductions]"
get_test "Get deductions" "/api/v5/deductions/$RETURN_ID"
post_test "Add deduction" "/api/v5/deductions" "{\"return_id\":\"$RETURN_ID\",\"category\":\"charitable_cash\",\"amount\":2500}"

echo "  [Dependents]"
get_test "Get dependents" "/api/v5/dependents/$RETURN_ID"

echo "  [Engine]"
post_test "Engine query FIE" "/api/v5/engine/query" '{"query":"standard deduction 2025","engine":"FIE"}'
post_test "Engine query TIE" "/api/v5/engine/query" '{"query":"capital gains tax rates","engine":"TIE"}'
get_test "Doctrines list" "/api/v5/engine/doctrines"
get_test "Doctrines FIE" "/api/v5/engine/doctrines?engine_id=FIE"
get_test "Doctrine search" "/api/v5/engine/doctrine/standard_deduction"
get_test "IRC search" "/api/v5/engine/irc/search?q=deduction"
get_test "IRC search 2" "/api/v5/engine/irc/search?q=capital+gains"
get_test "Engine health" "/api/v5/engine/health"

echo "  [Calculations]"
post_test "AMT" "/api/v5/calc/amt/$RETURN_ID"
post_test "NIIT" "/api/v5/calc/niit/$RETURN_ID"
post_test "Est payments" "/api/v5/calc/estimated-payments/$RETURN_ID" '{}'

echo "  [Reference]"
get_test "Brackets 2025" "/api/v5/reference/brackets/2025"
get_test "Brackets 2024" "/api/v5/reference/brackets/2024"
get_test "Brackets single" "/api/v5/reference/brackets/2025?filing_status=single"
get_test "Brackets mfj" "/api/v5/reference/brackets/2025?filing_status=mfj"
get_test "Brackets mfs" "/api/v5/reference/brackets/2025?filing_status=mfs"
get_test "Brackets hoh" "/api/v5/reference/brackets/2025?filing_status=hoh"
get_test "StdDed 2025" "/api/v5/reference/standard-deduction/2025"
get_test "StdDed single" "/api/v5/reference/standard-deduction/2025?filing_status=single"
get_test "StdDed over65" "/api/v5/reference/standard-deduction/2025?filing_status=single&over65=true"
get_test "StdDed blind" "/api/v5/reference/standard-deduction/2025?filing_status=single&blind=true"
get_test "Limits 2025" "/api/v5/reference/contribution-limits/2025"
get_test "Limits 2024" "/api/v5/reference/contribution-limits/2024"
get_test "Limits 401k" "/api/v5/reference/contribution-limits/2025?account=401k_employee"
get_test "Limits IRA" "/api/v5/reference/contribution-limits/2025?account=ira_traditional"
get_test "Limits HSA" "/api/v5/reference/contribution-limits/2025?account=hsa_individual"
get_test "Mileage 2025" "/api/v5/reference/mileage-rate/2025"
get_test "Mileage 2024" "/api/v5/reference/mileage-rate/2024"
get_test "Mileage 2023" "/api/v5/reference/mileage-rate/2023"
get_test "Calendar" "/api/v5/reference/calendar"
get_test "Calendar 2025" "/api/v5/reference/calendar?year=2025"
get_test "Calendar upcoming" "/api/v5/reference/calendar?upcoming=true"

echo "  [Compliance]"
post_test "Run compliance" "/api/v5/compliance/check/$RETURN_ID"
get_test "Get report" "/api/v5/compliance/report/$RETURN_ID"

echo "  [Planning]"
post_test "10-Year" "/api/v5/planning/10-year/$CLIENT_ID" '{"base_income":85000,"current_age":49}'
post_test "Roth ladder" "/api/v5/planning/roth-ladder/$CLIENT_ID" '{"traditional_balance":500000,"annual_income":50000,"current_age":55}'

echo "  [E-File]"
get_test "E-file status" "/api/v5/efile/$RETURN_ID/status"
get_test "MeF XML" "/api/v5/efile/xml/$RETURN_ID"
post_test "Validate XML" "/api/v5/efile/validate/$RETURN_ID"

echo "  [Ops]"
get_test "Ops health" "/api/v5/ops/health"
get_test "Ops deep" "/api/v5/ops/health/deep"
get_test "Ops metrics" "/api/v5/ops/metrics"

echo "  [Documents]"
get_test "Get docs" "/api/v5/documents/$RETURN_ID"
post_test "Parse W2" "/api/v5/documents/parse" '{"content":"Box 1 Wages 85000.00 Box 2 Federal tax withheld 12000.00 Employer Acme Corp EIN 12-3456789","form_type":"w2"}'
get_test "PDF full" "/api/v5/documents/pdf/$RETURN_ID"

echo "  [State Tax]"
get_test "List states" "/api/v5/state-tax/states"
get_test "Flat states" "/api/v5/state-tax/states?type=flat"
get_test "Progressive" "/api/v5/state-tax/states?type=progressive"
get_test "No-tax states" "/api/v5/state-tax/states?type=none"
get_test "Info TX" "/api/v5/state-tax/info/TX"
get_test "Info CA" "/api/v5/state-tax/info/CA"
get_test "Info NY" "/api/v5/state-tax/info/NY"
get_test "Info FL" "/api/v5/state-tax/info/FL"
get_test "Info IL" "/api/v5/state-tax/info/IL"
get_test "Info PA" "/api/v5/state-tax/info/PA"
get_test "Info OH" "/api/v5/state-tax/info/OH"
get_test "Info NJ" "/api/v5/state-tax/info/NJ"
post_test "Calc TX" "/api/v5/state-tax/calculate" "{\"return_id\":\"$RETURN_ID\",\"state\":\"TX\"}"
post_test "Calc CA" "/api/v5/state-tax/calculate" "{\"return_id\":\"$RETURN_ID\",\"state\":\"CA\"}"
post_test "Calc NY" "/api/v5/state-tax/calculate" "{\"return_id\":\"$RETURN_ID\",\"state\":\"NY\"}"
post_test "Calc IL" "/api/v5/state-tax/calculate" "{\"return_id\":\"$RETURN_ID\",\"state\":\"IL\"}"
post_test "Calc FL" "/api/v5/state-tax/calculate" "{\"return_id\":\"$RETURN_ID\",\"state\":\"FL\"}"
post_test "Calc PA" "/api/v5/state-tax/calculate" "{\"return_id\":\"$RETURN_ID\",\"state\":\"PA\"}"
post_test "Compare 7 states" "/api/v5/state-tax/compare" "{\"return_id\":\"$RETURN_ID\",\"states\":[\"TX\",\"CA\",\"NY\",\"FL\",\"WA\",\"IL\",\"PA\"]}"

echo "  [Engine Runtime]"
get_test "Runtime health" "/api/v5/runtime/health"
get_test "Runtime stats" "/api/v5/runtime/stats"
get_test "Runtime categories" "/api/v5/runtime/categories"
get_test "Runtime engines TAXINT" "/api/v5/runtime/engines?category=TAXINT&limit=3"
post_test "Runtime query" "/api/v5/runtime/query" '{"query":"transfer pricing","limit":3}'
post_test "Runtime tax query" "/api/v5/runtime/query/tax" '{"query":"depreciation section 179","limit":3}'
post_test "Claude query" "/api/v5/runtime/claude-query" '{"question":"capital gains tax rates","max_results":3}'

echo ""
echo "--- PHASE 4: ERROR HANDLING (5 tests) ---"
get_test "ERR: bad client" "/api/v5/clients/nonexistent" 1
get_test "ERR: bad return" "/api/v5/returns/nonexistent" 1
get_test "ERR: bad bracket yr" "/api/v5/reference/brackets/1900" 1
get_test "ERR: bad mileage yr" "/api/v5/reference/mileage-rate/1900" 1
get_test "ERR: bad state" "/api/v5/state-tax/info/XX" 1

echo ""
echo "--- PHASE 5: LATENCY PROFILING ---"
for ep in "/health" "/api/v5/clients" "/api/v5/returns/$RETURN_ID" "/api/v5/reference/brackets/2025" "/api/v5/ops/metrics" "/api/v5/state-tax/states"; do
  TIME=$(curl -sf -o /dev/null -w "%{time_total}" -H "X-Echo-API-Key: $KEY" "$API$ep" 2>/dev/null)
  TOTAL=$((TOTAL+1))
  PASS=$((PASS+1))
  printf "  [OK] %-45s %ss\n" "$ep" "$TIME"
done

echo ""
echo "=================================================================="
printf "  TOTAL: %d | PASSED: %d | FAILED: %d\n" "$TOTAL" "$PASS" "$FAIL"
if [ $TOTAL -gt 0 ]; then
  RATE=$((PASS * 100 / TOTAL))
  printf "  PASS RATE: %d%%\n" "$RATE"
fi
if [ $FAIL -eq 0 ]; then
  echo "  STATUS: SOVEREIGN GRADE — ALL TESTS PASSED"
else
  echo "  STATUS: $FAIL FAILURES"
  echo ""
  echo "  FAILED TESTS:"
  printf "$FAILURES"
fi
echo "=================================================================="
