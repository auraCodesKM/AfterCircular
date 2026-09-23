# Deploying AfterCircular to Azure Container Apps

Two containers — `aftercircular-web` (Next.js) and `aftercircular-api` (FastAPI) — built in Azure Container Registry and
run in one Container Apps environment. The API is **internal-only**: the browser talks to the web app, which proxies to
the API server-side (that is where the backend key and the user's GitHub token live). State is SQLite on an Azure Files
share; the AI services are the ones the demo already uses.

Everything below is idempotent unless it says otherwise. No command here prints a secret.

| | value |
|---|---|
| Subscription | Azure for Students |
| Resource group | `rg-aftercircular-dev` (exists) |
| Region | Korea Central |
| Foundry | `aif-aftercircular-dev` / project `proj-aftercircular-dev` (exists) |
| Models | `gpt-5-mini`, `text-embedding-3-small` (exist) |
| Search | `srch-aftercircular-dev`, index `policies-dev` (exists) |
| Monitoring | `appi-aftercircular-dev`, `log-aftercircular-dev` (exist) |
| To create | ACR, storage account + file share, Container Apps environment, two container apps |

## 1. Prerequisites

```bash
az version                      # Azure CLI ≥ 2.60
az extension add --name containerapp --upgrade
docker --version                # only for the local production-like run
git rev-parse --short=12 HEAD   # image tags are commit SHAs
```

## 2–4. Login, subscription, resource group

```bash
az login
az account set --subscription "<Azure for Students subscription id>"
az group show -n rg-aftercircular-dev -o table          # must already exist
export RESOURCE_GROUP=rg-aftercircular-dev LOCATION=koreacentral
```

## 5. Container registry

```bash
export ACR_NAME=acraftercirculardev                      # globally unique, lowercase, no dashes
az acr create -g $RESOURCE_GROUP -n $ACR_NAME --sku Basic --location $LOCATION
```

Basic is enough: two small images, one region, no geo-replication.

## 6. Durable storage (Azure Files) and the Container Apps environment

Container filesystems are ephemeral — a revision swap or a restart discards them — so the SQLite database must live on a
mounted share.

```bash
export STORAGE=staftercirculardev SHARE=aftercircular-data ENV_NAME=acae-aftercircular-dev
az storage account create -g $RESOURCE_GROUP -n $STORAGE -l $LOCATION --sku Standard_LRS --kind StorageV2
az storage share-rm create -g $RESOURCE_GROUP --storage-account $STORAGE -n $SHARE --quota 5

az containerapp env create -g $RESOURCE_GROUP -n $ENV_NAME -l $LOCATION \
  --logs-destination log-analytics \
  --logs-workspace-id $(az monitor log-analytics workspace show -g $RESOURCE_GROUP -n log-aftercircular-dev --query customerId -o tsv) \
  --logs-workspace-key $(az monitor log-analytics workspace get-shared-keys -g $RESOURCE_GROUP -n log-aftercircular-dev --query primarySharedKey -o tsv)

az containerapp env storage set -g $RESOURCE_GROUP -n $ENV_NAME --storage-name acdata \
  --azure-file-account-name $STORAGE --azure-file-share-name $SHARE \
  --azure-file-account-key $(az storage account keys list -g $RESOURCE_GROUP -n $STORAGE --query "[0].value" -o tsv) \
  --access-mode ReadWrite
```

## 7–8. First images

```bash
./scripts/azure-build.sh                 # az acr build for both images, tagged <git sha> and latest
export GIT_SHA=$(git rev-parse --short=12 HEAD)
```

## 9. The API container app (internal ingress, managed identity, mounted share)

```bash
az containerapp create -g $RESOURCE_GROUP -n aca-aftercircular-api --environment $ENV_NAME \
  --image $ACR_NAME.azurecr.io/aftercircular-api:$GIT_SHA \
  --registry-server $ACR_NAME.azurecr.io --registry-identity system \
  --system-assigned \
  --ingress internal --target-port 8000 --transport auto \
  --min-replicas 1 --max-replicas 1 --cpu 0.5 --memory 1Gi \
  --env-vars ENVIRONMENT=production PORT=8000 DATABASE_PATH=/data/aftercircular.db SQLITE_JOURNAL_MODE=DELETE \
             SEBI_MODE=live AI_PROVIDER=foundry \
             FOUNDRY_ENDPOINT=https://aif-aftercircular-dev.openai.azure.com/ FOUNDRY_API=responses \
             EXTRACTION_MODEL=gpt-5-mini IMPACT_MODEL=gpt-5-mini MEMO_MODEL=gpt-5-mini \
             EMBEDDING_MODEL=text-embedding-3-small EMBEDDING_DIMENSIONS=1536 \
             AZURE_SEARCH_ENDPOINT=https://srch-aftercircular-dev.search.windows.net AZURE_SEARCH_INDEX=policies-dev \
             SEBI_SELECTED_ENTRY_IDS=102584,102762,102914,102986,103915,104387
```

**One replica on purpose.** SQLite on a single share wants a single writer; `--min-replicas 1` also keeps the scan
loop and the app warm. Scaling out means moving to PostgreSQL first (see `azureDecision.md` §21).

Mount the share and add the secrets (values come from your own environment — never from this file):

```bash
az containerapp update -g $RESOURCE_GROUP -n aca-aftercircular-api \
  --set-env-vars CORS_ORIGINS=https://<web-fqdn-from-step-10> \
  --secrets backend-api-key="$BACKEND_API_KEY" github-token="$GITHUB_TOKEN" typesafe-api-key="$TYPESAFE_API_KEY" \
            appinsights="$(az monitor app-insights component show -g $RESOURCE_GROUP -a appi-aftercircular-dev --query connectionString -o tsv)"
az containerapp update -g $RESOURCE_GROUP -n aca-aftercircular-api \
  --set-env-vars BACKEND_API_KEY=secretref:backend-api-key GITHUB_TOKEN=secretref:github-token \
                 TYPESAFE_API_KEY=secretref:typesafe-api-key APPLICATIONINSIGHTS_CONNECTION_STRING=secretref:appinsights

# mount Azure Files at /data (YAML is the only way to express a volume mount today)
az containerapp show -g $RESOURCE_GROUP -n aca-aftercircular-api -o yaml > /tmp/api.yaml
# under properties.template add:
#   volumes: [{ name: data, storageType: AzureFile, storageName: acdata }]
# and inside containers[0]: volumeMounts: [{ volumeName: data, mountPath: /data }]
az containerapp update -g $RESOURCE_GROUP -n aca-aftercircular-api --yaml /tmp/api.yaml
```

Health probes (also expressible in the same YAML; both are cheap and never call a model):

| probe | path | note |
|---|---|---|
| startup | `/health/live` | process is up |
| liveness | `/health/live` | no I/O |
| readiness | `/health/ready` | one SQLite read + the production configuration contract |

## 10. RBAC for the API's managed identity

No Azure API keys anywhere: the API authenticates to Foundry and Search with its system-assigned identity.

```bash
API_PRINCIPAL=$(az containerapp show -g $RESOURCE_GROUP -n aca-aftercircular-api --query identity.principalId -o tsv)
SUB=$(az account show --query id -o tsv)

# chat + embeddings on the Foundry resource
az role assignment create --assignee $API_PRINCIPAL --role "Cognitive Services OpenAI User" \
  --scope /subscriptions/$SUB/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.CognitiveServices/accounts/aif-aftercircular-dev

# read + upsert policy chunks in the one index (the app creates/updates documents, not the service)
az role assignment create --assignee $API_PRINCIPAL --role "Search Index Data Contributor" \
  --scope /subscriptions/$SUB/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Search/searchServices/srch-aftercircular-dev
# the app also ensures the index exists on first run; grant this once, or create the index by hand and drop it:
az role assignment create --assignee $API_PRINCIPAL --role "Search Service Contributor" \
  --scope /subscriptions/$SUB/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Search/searchServices/srch-aftercircular-dev

# pull images from ACR
az role assignment create --assignee $API_PRINCIPAL --role AcrPull \
  --scope /subscriptions/$SUB/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME
```

Search must accept Entra tokens: `az search service update -g $RESOURCE_GROUP -n srch-aftercircular-dev --auth-options aadOrApiKey --aad-auth-failure-mode http401WithBearerChallenge`.

Still a static secret, and why: **GitHub** (a user/PAT token — GitHub is not an Azure resource), **TypeSafe/Jev** (third-party API key), **BACKEND_API_KEY** (shared secret between the two apps), **Auth.js GitHub OAuth client secret** (GitHub OAuth app). All are Container Apps secrets, never image layers.

## 11. The web container app (external ingress)

```bash
az containerapp create -g $RESOURCE_GROUP -n aca-aftercircular-web --environment $ENV_NAME \
  --image $ACR_NAME.azurecr.io/aftercircular-web:$GIT_SHA \
  --registry-server $ACR_NAME.azurecr.io --registry-identity system --system-assigned \
  --ingress external --target-port 3000 --transport auto \
  --min-replicas 1 --max-replicas 3 --cpu 0.5 --memory 1Gi \
  --env-vars NODE_ENV=production PORT=3000 BACKEND_URL=http://aca-aftercircular-api AUTH_TRUST_HOST=true

WEB_FQDN=$(az containerapp show -g $RESOURCE_GROUP -n aca-aftercircular-web --query properties.configuration.ingress.fqdn -o tsv)
az containerapp update -g $RESOURCE_GROUP -n aca-aftercircular-web \
  --secrets auth-secret="$AUTH_SECRET" gh-id="$AUTH_GITHUB_ID" gh-secret="$AUTH_GITHUB_SECRET" backend-api-key="$BACKEND_API_KEY" \
  --set-env-vars AUTH_URL=https://$WEB_FQDN AUTH_SECRET=secretref:auth-secret \
                 AUTH_GITHUB_ID=secretref:gh-id AUTH_GITHUB_SECRET=secretref:gh-secret \
                 BACKEND_API_KEY=secretref:backend-api-key
az role assignment create --assignee $(az containerapp show -g $RESOURCE_GROUP -n aca-aftercircular-web --query identity.principalId -o tsv) \
  --role AcrPull --scope /subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME
```

Then point the GitHub OAuth app's callback at `https://$WEB_FQDN/api/auth/callback/github`, and set the API's
`CORS_ORIGINS=https://$WEB_FQDN` (step 9). The browser never calls the API directly, so CORS only covers the
same-origin proxy; it is still explicit, never `*`.

## 12. First data load

Nothing is seeded automatically — no demo reset, no fictional data, no destructive schema work at startup. The schema is
created/migrated additively on first connection. After deploying, sign in and press **Scan now** for each tenant, or
run one bounded scan through the API.

## 13. Smoke test

```bash
WEB_FQDN=$WEB_FQDN ./scripts/azure-smoke-test.sh
```

Checks the web ingress, the anonymous redirect, `/health/live`, `/health/ready` and that the API reports
`foundry` + `azure-ai-search` + `sebi_mode=live` + `environment=production`.

## 14. Logs

```bash
az containerapp logs show -g $RESOURCE_GROUP -n aca-aftercircular-api --follow --tail 100
az monitor log-analytics query -w $(az monitor log-analytics workspace show -g $RESOURCE_GROUP -n log-aftercircular-dev --query customerId -o tsv) \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'aca-aftercircular-api' | where Log_s contains 'llm_call' | take 50"
```

Application Insights (`appi-aftercircular-dev`) receives requests, dependencies and exceptions when the connection
string is set; model telemetry stays in the database and on `/api/usage`.

## 15. Subsequent deployments

```bash
./scripts/azure-build.sh                       # or run the "Publish images" GitHub workflow
GIT_SHA=<sha> ./scripts/azure-deploy.sh
WEB_FQDN=$WEB_FQDN ./scripts/azure-smoke-test.sh
```

## 16. Rollback

Revisions are immutable, so rolling back is pointing at the previous tag (or reactivating its revision):

```bash
az containerapp revision list -g $RESOURCE_GROUP -n aca-aftercircular-api -o table
GIT_SHA=<previous sha> ./scripts/azure-deploy.sh
# or: az containerapp revision activate -g $RESOURCE_GROUP -n aca-aftercircular-api --revision <name>
```

The database is outside the container, so a rollback does not lose analyses, reviews or audit events.

## 17. Demo reset (manual only)

`scripts/demo_reset.py` deletes one tenant's derived state and its documents in the search index. It refuses to run
unless `ENVIRONMENT` is `dev` or `demo`, it is never invoked by the image, the startup path, a probe or a workflow, and
it takes explicit `--tenant` and `--yes`. Locally:

```bash
cd backend && uv run python scripts/demo_reset.py --tenant <tenant_id> --yes
```

## 18. GitHub Actions (OIDC, no stored Azure secret)

```bash
az ad app create --display-name aftercircular-ci
APP_ID=$(az ad app list --display-name aftercircular-ci --query "[0].appId" -o tsv)
az ad sp create --id $APP_ID
az ad app federated-credential create --id $APP_ID --parameters '{
  "name":"github-main","issuer":"https://token.actions.githubusercontent.com",
  "subject":"repo:auraCodesKM/AfterCircular:ref:refs/heads/main","audiences":["api://AzureADTokenExchange"]}'
az role assignment create --assignee $APP_ID --role "AcrPush" \
  --scope /subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME
```

Repository secrets: `AZURE_CLIENT_ID` (`$APP_ID`), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. Repository variables:
`ACR_NAME`, `RESOURCE_GROUP`. `ci.yml` runs tests and builds both images on every push; `publish-images.yml` pushes to
ACR on demand. **Deployment stays manual** — a compliance system's only side effect should not ship on a green build.

## 19. Shutdown / deletion

```bash
az containerapp update -g $RESOURCE_GROUP -n aca-aftercircular-api --min-replicas 0   # stop paying for compute
az containerapp update -g $RESOURCE_GROUP -n aca-aftercircular-web --min-replicas 0
# full teardown (destructive — the Azure Files share holds the database):
# az containerapp delete -g $RESOURCE_GROUP -n aca-aftercircular-web --yes
# az containerapp delete -g $RESOURCE_GROUP -n aca-aftercircular-api --yes
# az containerapp env delete -g $RESOURCE_GROUP -n $ENV_NAME --yes
# az acr delete -g $RESOURCE_GROUP -n $ACR_NAME --yes
# az storage account delete -g $RESOURCE_GROUP -n $STORAGE --yes
```

Foundry, Search, Application Insights and Log Analytics are shared with the demo — deleting them breaks it.

## Local production-like run

```bash
cp backend/.env.example backend/.env   # fill in; keys stay empty when you use Entra ID
cp web/.env.example web/.env.local     # if present, else see README
AC_UID=$(id -u) AC_GID=$(id -g) docker compose up --build
open http://localhost:3000
docker compose logs -f api
docker compose down          # add -v to drop volumes
```

The compose file runs the same two images with `./backend/data` bind-mounted at `/data`. Entra ID inside a container
cannot use the host's `az login` (there is no CLI in the image), so for real Foundry/Search calls locally, export a dev
service principal first — `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` — or run the backend on the host
with `uv run uvicorn`. Without either, Foundry calls fail loudly and the UI says so; nothing is faked.
