#!/usr/bin/env bash
# Point both container apps at an immutable image tag and wait for the new revisions.
#   GIT_SHA=<sha> ./scripts/azure-deploy.sh
# Creates nothing: the apps, their secrets and their identities are set up once per DEPLOYMENT.md. Prints no secrets.
set -euo pipefail

: "${GIT_SHA:?set GIT_SHA to the tag produced by scripts/azure-build.sh}"
: "${ACR_NAME:=acraftercirculardev}"
: "${RESOURCE_GROUP:=rg-aftercircular-dev}"
: "${API_APP:=aca-aftercircular-api}"
: "${WEB_APP:=aca-aftercircular-web}"
REGISTRY="$ACR_NAME.azurecr.io"

for app in "$API_APP" "$WEB_APP"; do
  az containerapp show -n "$app" -g "$RESOURCE_GROUP" -o none  # fail fast if it does not exist
done

echo "api  → $REGISTRY/aftercircular-api:$GIT_SHA"
az containerapp update -n "$API_APP" -g "$RESOURCE_GROUP" --image "$REGISTRY/aftercircular-api:$GIT_SHA" -o none
echo "web  → $REGISTRY/aftercircular-web:$GIT_SHA"
az containerapp update -n "$WEB_APP" -g "$RESOURCE_GROUP" --image "$REGISTRY/aftercircular-web:$GIT_SHA" -o none

for app in "$API_APP" "$WEB_APP"; do
  state=$(az containerapp revision list -n "$app" -g "$RESOURCE_GROUP" --query "[?properties.active].properties.runningState | [0]" -o tsv)
  echo "$app: latest revision $state"
done
WEB_FQDN=$(az containerapp show -n "$WEB_APP" -g "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)
echo "web: https://$WEB_FQDN"
echo "smoke test: WEB_FQDN=$WEB_FQDN ./scripts/azure-smoke-test.sh"
