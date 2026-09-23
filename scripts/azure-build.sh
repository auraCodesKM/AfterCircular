#!/usr/bin/env bash
# Build both images in Azure Container Registry and tag them with the current git SHA (immutable) and `latest`.
#   ./scripts/azure-build.sh
# Requires: az login, and ACR/RG to exist (see DEPLOYMENT.md §5). Prints no secrets.
set -euo pipefail

: "${ACR_NAME:=acraftercirculardev}"
: "${RESOURCE_GROUP:=rg-aftercircular-dev}"
GIT_SHA="$(git rev-parse --short=12 HEAD)"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "working tree is dirty — commit first so the image tag identifies real code" >&2
  exit 1
fi

for target in api web; do
  src=$([ "$target" = api ] && echo backend || echo web)
  echo "building aftercircular-$target:$GIT_SHA from $src/"
  az acr build --registry "$ACR_NAME" --resource-group "$RESOURCE_GROUP" \
    --image "aftercircular-$target:$GIT_SHA" --image "aftercircular-$target:latest" \
    --file "$src/Dockerfile" "$src"
done

echo
echo "built:"
echo "  $ACR_NAME.azurecr.io/aftercircular-api:$GIT_SHA"
echo "  $ACR_NAME.azurecr.io/aftercircular-web:$GIT_SHA"
echo "deploy them with: GIT_SHA=$GIT_SHA ./scripts/azure-deploy.sh"
