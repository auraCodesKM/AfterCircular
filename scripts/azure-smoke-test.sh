#!/usr/bin/env bash
# Read-only checks against a deployed revision. Creates nothing, changes nothing, prints no secrets.
#   WEB_FQDN=<app>.<region>.azurecontainerapps.io ./scripts/azure-smoke-test.sh
set -euo pipefail

: "${RESOURCE_GROUP:=rg-aftercircular-dev}"
: "${API_APP:=aca-aftercircular-api}"
: "${WEB_APP:=aca-aftercircular-web}"
: "${WEB_FQDN:=$(az containerapp show -n "$WEB_APP" -g "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)}"

fail=0
check() { printf '%-42s %s\n' "$1" "$2"; [ "$2" = OK ] || fail=1; }

code=$(curl -s -o /dev/null -w '%{http_code}' "https://$WEB_FQDN/signin"); check "web /signin" "$([ "$code" = 200 ] && echo OK || echo "HTTP $code")"
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$WEB_FQDN/dashboard"); check "web /dashboard redirects anon" "$([ "$code" = 307 ] || [ "$code" = 302 ] && echo OK || echo "HTTP $code")"

# the API has internal ingress: probe it from inside the environment, through the web app's network namespace
probe() { az containerapp exec -n "$WEB_APP" -g "$RESOURCE_GROUP" --command "node -e \"fetch('http://$API_APP/$1').then(async r=>{console.log(r.status, (await r.text()).slice(0,300))}).catch(e=>{console.log('ERR',e.message)})\"" 2>/dev/null | tail -1; }
live=$(probe "health/live"); check "api /health/live" "$(echo "$live" | grep -q '200' && echo OK || echo "$live")"
ready=$(probe "health/ready"); check "api /health/ready" "$(echo "$ready" | grep -q '"ok":true' && echo OK || echo "$ready")"
health=$(probe "health")
echo "$health" | grep -q '"ai_provider":"foundry"'      && check "AI provider" OK      || check "AI provider" "not foundry"
echo "$health" | grep -q '"retrieval":"azure-ai-search"' && check "retrieval" OK       || check "retrieval" "not azure-ai-search"
echo "$health" | grep -q '"sebi_mode":"live"'            && check "SEBI mode" OK       || check "SEBI mode" "not live"
echo "$health" | grep -q '"environment":"production"'    && check "environment" OK     || check "environment" "not production"

rev=$(az containerapp revision list -n "$API_APP" -g "$RESOURCE_GROUP" --query "[?properties.active].{n:name,s:properties.runningState}" -o tsv)
echo "active api revision: $rev"
exit $fail
