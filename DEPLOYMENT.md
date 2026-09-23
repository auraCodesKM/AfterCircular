# Deploying AfterCircular to Azure

This is the exact sequence that produced the running deployment, including the problems we hit and how they were
solved, so anyone can rebuild it from an empty subscription. No command here prints a secret; values you must supply
are written as `$VARIABLES`.

```
Browser ──HTTPS──► aca-aftercircular-web (Next.js, external ingress)
                        │  server-side proxy: backend API key + tenant headers + the user's GitHub token
                        ▼
                   aca-aftercircular-api (FastAPI, internal ingress, 1 replica) ──► SQLite on Azure Files (/data)
                        │ managed identity (Entra ID)            │ static secrets
                        ├──► Microsoft Foundry: gpt-5-mini, text-embedding-3-small
                        ├──► Azure AI Search: policies-dev (hybrid vector + keyword)
                        ├──► Jev (TypeSafe System One) · GitHub (user OAuth token, issues only after approval)
                        └──► aci-aftercircular-sebi-relay (East Asia, CONNECT-only) ──► www.sebi.gov.in
                   Application Insights + Log Analytics ◄── telemetry and container logs
```

## Current deployment (verified 2026-09-23)

| | value |
|---|---|
| Subscription | Azure for Students (allowed regions: koreacentral, eastasia, malaysiawest, indonesiacentral, uaenorth; one Container Apps environment per subscription) |
| Resource group | `rg-aftercircular-dev`, Korea Central |
| Foundry | `aif-aftercircular-dev` (AIServices, S0) + project `proj-aftercircular-dev`; deployments `gpt-5-mini` (2025-08-07, GlobalStandard) and `text-embedding-3-small` (GlobalStandard) |
| Search | `srch-aftercircular-dev` (Free), index `policies-dev` (1536-dim HNSW vectors + keyword) |
| Registry | `acraftercirculardev` (Basic) |
| Storage | `staftercirculardev` (Standard LRS), file share `aftercircular-data` → `/data` in the API |
| Container Apps | environment `acae-aftercircular-dev` (WorkloadProfiles, Consumption); `aca-aftercircular-api` (internal, 0.25 vCPU / 0.5 GiB, min = max = 1); `aca-aftercircular-web` (external, 0.5 vCPU / 1 GiB, 1–3) |
| Web URL | https://aca-aftercircular-web.salmonbay-7447d6fc.koreacentral.azurecontainerapps.io |
| SEBI relay | `aci-aftercircular-sebi-relay`, Container Instance in **East Asia**, 0.5 vCPU, `aftercircular-sebi-relay.eastasia.azurecontainer.io:3128` |
| Identities | `id-aftercircular-api`: Cognitive Services OpenAI User (Foundry), Search Index Data Contributor + Search Service Contributor (Search), AcrPull. `id-aftercircular-web`: AcrPull |
| Monitoring | `appi-aftercircular-dev` (workspace-based, 90-day retention) on `log-aftercircular-dev` (30-day retention, 0.1 GB/day cap) |

Verified at runtime, not by configuration: `/health/live` and `/health/ready` return 200 with `environment=production`;
SQLite reads and writes on the share and keeps its rows across revision restarts and a full environment re-creation;
real `gpt-5-mini` Responses calls, 1536-dim embeddings and hybrid Azure AI Search retrieval from inside the API
container; Jev refusing an "approve and open the issue" request; a live scan (`scan_0ae1631957db`): SEBI `LIVE_SUCCESS`,
6 circulars, 48 policy chunks embedded and indexed, 3 archived at Jev triage, 2 `NEEDS_INVESTIGATION`, 1 `CONFLICT` →
memo → review awaiting human approval, 6 Foundry calls, 0 errors. `scripts/azure-smoke-test.sh` passes 8/8.

Observed cost for the whole project so far (Azure Cost Management, 21–23 Sep): ₹158 ≈ $1.65 of the $100 student credit —
Foundry models ₹121 (output tokens ₹109), Grounding with Bing (Ask's web lookup) ₹33, ACR ₹4; Search, Storage and Log
Analytics inside free units. Container Apps and the relay are always-on and bill per second.

---

## 0. Prerequisites

```bash
az version                                    # Azure CLI ≥ 2.60
az extension add --name containerapp --upgrade
az extension add --name application-insights --upgrade
docker buildx version                         # images are built locally (ACR Tasks are not allowed on Azure for Students)
gh auth status                                # optional, for the GitHub OAuth app and policy repository

export RG=rg-aftercircular-dev LOC=koreacentral SUB=$(az account show --query id -o tsv)
export FOUNDRY=aif-aftercircular-dev SEARCH=srch-aftercircular-dev ACR=acraftercirculardev
export STORAGE=staftercirculardev SHARE=aftercircular-data ENV=acae-aftercircular-dev
export LAW=log-aftercircular-dev APPI=appi-aftercircular-dev
az group create -n $RG -l $LOC
```

## 1. Microsoft Foundry and the two model deployments

```bash
az cognitiveservices account create -n $FOUNDRY -g $RG -l $LOC --kind AIServices --sku S0 --custom-domain $FOUNDRY --allow-project-management
az cognitiveservices account project create -g $RG -n $FOUNDRY --project-name proj-aftercircular-dev -l $LOC
az cognitiveservices account deployment create -g $RG -n $FOUNDRY --deployment-name gpt-5-mini \
  --model-name gpt-5-mini --model-version 2025-08-07 --model-format OpenAI --sku-name GlobalStandard --sku-capacity 50
az cognitiveservices account deployment create -g $RG -n $FOUNDRY --deployment-name text-embedding-3-small \
  --model-name text-embedding-3-small --model-version 1 --model-format OpenAI --sku-name GlobalStandard --sku-capacity 50
```

Capacity is in thousands of tokens per minute; the app caps itself (12 model calls and ≈$0.50 per scan, ≈$5 per day),
so a small quota is enough. Pick a region your subscription allows that offers both models.

## 2. Azure AI Search

```bash
az search service create -n $SEARCH -g $RG -l $LOC --sku free
az search service update -n $SEARCH -g $RG --auth-options aadOrApiKey --aad-auth-failure-mode http401WithBearerChallenge
```

The API creates `policies-dev` on first use (schema: [`docs/azure/policies-dev.index.json`](docs/azure/policies-dev.index.json)),
which is why its identity also needs **Search Service Contributor** (step 7). Every document carries `tenant_id` and every
query filters on it.

## 3. Monitoring

```bash
az monitor log-analytics workspace create -g $RG -n $LAW -l $LOC --retention-time 30 --quota 0.1
az monitor app-insights component create -g $RG -a $APPI -l $LOC --workspace $LAW
```

## 4. Registry, storage and the file share

```bash
az acr create -g $RG -n $ACR --sku Basic -l $LOC                     # admin user stays disabled
az storage account create -g $RG -n $STORAGE -l $LOC --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false
az storage share-rm create -g $RG --storage-account $STORAGE -n $SHARE --quota 5
```

## 5. The Container Apps environment — create it through ARM

`az containerapp env create` (CLI 2.90) creates an **Express** environment, and Express environments cannot mount Azure
Files. Create a **WorkloadProfiles** environment explicitly:

```bash
LAW_ID=$(az monitor log-analytics workspace show -g $RG -n $LAW --query customerId -o tsv)
LAW_KEY=$(az monitor log-analytics workspace get-shared-keys -g $RG -n $LAW --query primarySharedKey -o tsv)
az rest --method put \
  --url "https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.App/managedEnvironments/$ENV?api-version=2025-10-02-preview" \
  --body "{\"location\":\"$LOC\",\"properties\":{\"environmentMode\":\"WorkloadProfiles\",
           \"workloadProfiles\":[{\"name\":\"Consumption\",\"workloadProfileType\":\"Consumption\"}],
           \"appLogsConfiguration\":{\"destination\":\"log-analytics\",\"logAnalyticsConfiguration\":{\"customerId\":\"$LAW_ID\",\"sharedKey\":\"$LAW_KEY\"}}}}"
az containerapp env storage set -g $RG -n $ENV --storage-name acdata --azure-file-account-name $STORAGE \
  --azure-file-share-name $SHARE --access-mode ReadWrite \
  --azure-file-account-key "$(az storage account keys list -g $RG -n $STORAGE --query '[0].value' -o tsv)"
unset LAW_KEY
```

## 6. Images

```bash
git status --short          # must be empty: image tags are commit SHAs
./scripts/azure-build.sh    # docker buildx for linux/amd64 → acraftercirculardev.azurecr.io/aftercircular-{api,web}:<sha>
export SHA=$(git rev-parse --short=12 HEAD)
docker buildx build --platform linux/amd64 --provenance=false -t $ACR.azurecr.io/sebi-proxy:$SHA --push infra/sebi-proxy
```

## 7. Managed identities and role assignments (no Azure keys in the apps)

```bash
az identity create -g $RG -n id-aftercircular-api
az identity create -g $RG -n id-aftercircular-web
API_PID=$(az identity show -g $RG -n id-aftercircular-api --query principalId -o tsv)
WEB_PID=$(az identity show -g $RG -n id-aftercircular-web --query principalId -o tsv)
role() { az role assignment create --assignee-object-id $1 --assignee-principal-type ServicePrincipal --role "$2" --scope "$3" -o none; }
role $API_PID "Cognitive Services OpenAI User"  $(az cognitiveservices account show -g $RG -n $FOUNDRY --query id -o tsv)
role $API_PID "Search Index Data Contributor"   $(az search service show -g $RG -n $SEARCH --query id -o tsv)
role $API_PID "Search Service Contributor"      $(az search service show -g $RG -n $SEARCH --query id -o tsv)   # get_index; without it indexing fails with 403
role $API_PID AcrPull                           $(az acr show -g $RG -n $ACR --query id -o tsv)
role $WEB_PID AcrPull                           $(az acr show -g $RG -n $ACR --query id -o tsv)
```

Static secrets, and why they stay secrets: the Jev (TypeSafe) API key and the GitHub OAuth app are third-party, the
backend key is shared between the two apps, and the relay password protects the relay. All live as Container Apps /
Container Instance secrets — never in an image, a workflow or git.

## 8. The SEBI relay (East Asia)

`www.sebi.gov.in` completes TCP but drops the TLS handshake from Azure Korea Central (verified with default TLS, TLS 1.2
only, X25519 only and a 1200-byte MSS clamp; RBI and NSE work from the same container). From East Asia and Malaysia West
it answers with the genuine certificate. Only the SEBI connector goes through this relay:

```bash
export RELAY_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
WEB_ID=$(az identity show -g $RG -n id-aftercircular-web --query id -o tsv)
az container create -g $RG -n aci-aftercircular-sebi-relay -l eastasia \
  --image $ACR.azurecr.io/sebi-proxy:$SHA --acr-identity $WEB_ID --assign-identity $WEB_ID \
  --os-type Linux --cpu 0.5 --memory 0.5 --restart-policy Always \
  --ports 3128 --ip-address Public --dns-name-label aftercircular-sebi-relay \
  --environment-variables ALLOWED_TARGET=www.sebi.gov.in:443 PORT=3128 \
  --secure-environment-variables PROXY_USER=aftercircular PROXY_PASSWORD="$RELAY_PASSWORD"
```

The relay ([`infra/sebi-proxy/proxy.py`](infra/sebi-proxy/proxy.py), stdlib only) accepts only an authenticated
`CONNECT www.sebi.gov.in:443`, tunnels bytes, and never decrypts: the API does the TLS handshake with SEBI and verifies
the certificate itself. Anything else gets 403/405/407. Container Instances hides the caller's address, so there is no
source allowlist; the controls are the 256-bit password and the single fixed target. If the relay is down, scans fail
as `LIVE_FAILED` — never a snapshot.

## 9. The API container app

Mount options matter: `nobrl` stops SQLite's byte-range locks from being sent to Azure Files (without it a revision hung
on the lock and held the database), and `uid/gid=10001` match the image's non-root user.

```bash
export API_ID=$(az identity show -g $RG -n id-aftercircular-api --query id -o tsv)
export API_CLIENT_ID=$(az identity show -g $RG -n id-aftercircular-api --query clientId -o tsv)
export ENV_ID=$(az containerapp env show -g $RG -n $ENV --query id -o tsv)
export WEB_URL=https://aca-aftercircular-web.$(az containerapp env show -g $RG -n $ENV --query properties.defaultDomain -o tsv)
cat > /tmp/api.yaml <<EOF
location: $LOC
identity: { type: UserAssigned, userAssignedIdentities: { "$API_ID": {} } }
properties:
  managedEnvironmentId: $ENV_ID
  configuration:
    activeRevisionsMode: Single
    ingress: { external: false, targetPort: 8000, transport: auto }
    registries: [ { server: $ACR.azurecr.io, identity: "$API_ID" } ]
    secrets:
      - { name: backend-api-key, value: "$BACKEND_API_KEY" }
      - { name: typesafe-api-key, value: "$TYPESAFE_API_KEY" }
      - { name: appinsights, value: "$(az monitor app-insights component show -g $RG -a $APPI --query connectionString -o tsv)" }
      - { name: sebi-proxy-url, value: "http://aftercircular:$RELAY_PASSWORD@aftercircular-sebi-relay.eastasia.azurecontainer.io:3128" }
  template:
    scale: { minReplicas: 1, maxReplicas: 1 }          # SQLite: exactly one writer
    volumes: [ { name: data, storageType: AzureFile, storageName: acdata,
                 mountOptions: "uid=10001,gid=10001,dir_mode=0770,file_mode=0660,nobrl,mfsymlinks,cache=strict" } ]
    containers:
      - name: api
        image: $ACR.azurecr.io/aftercircular-api:$SHA
        resources: { cpu: 0.25, memory: 0.5Gi }
        volumeMounts: [ { volumeName: data, mountPath: /data } ]
        probes:
          - { type: Startup,   httpGet: { path: /health/live,  port: 8000 }, initialDelaySeconds: 3, periodSeconds: 5, failureThreshold: 24, timeoutSeconds: 5 }
          - { type: Liveness,  httpGet: { path: /health/live,  port: 8000 }, periodSeconds: 30, timeoutSeconds: 5 }
          - { type: Readiness, httpGet: { path: /health/ready, port: 8000 }, periodSeconds: 15, failureThreshold: 3, timeoutSeconds: 5 }
        env:
          - { name: ENVIRONMENT, value: production }
          - { name: PORT, value: "8000" }
          - { name: DATABASE_PATH, value: /data/aftercircular.db }
          - { name: SQLITE_JOURNAL_MODE, value: DELETE }
          - { name: CORS_ORIGINS, value: $WEB_URL }
          - { name: AI_PROVIDER, value: foundry }
          - { name: FOUNDRY_ENDPOINT, value: "https://$FOUNDRY.openai.azure.com" }
          - { name: FOUNDRY_API, value: responses }
          - { name: EXTRACTION_MODEL, value: gpt-5-mini }
          - { name: IMPACT_MODEL, value: gpt-5-mini }
          - { name: MEMO_MODEL, value: gpt-5-mini }
          - { name: EMBEDDING_MODEL, value: text-embedding-3-small }
          - { name: EMBEDDING_DIMENSIONS, value: "1536" }
          - { name: AZURE_SEARCH_ENDPOINT, value: "https://$SEARCH.search.windows.net" }
          - { name: AZURE_SEARCH_INDEX, value: policies-dev }
          - { name: AZURE_CLIENT_ID, value: $API_CLIENT_ID }
          - { name: SEBI_MODE, value: live }
          - { name: SEBI_MAX_DOCUMENTS, value: "6" }
          - { name: SEBI_SELECTED_ENTRY_IDS, value: "102584,102762,102914,102986,103915,104387" }
          - { name: DEFAULT_JUDGE, value: typesafe }
          - { name: AFTERCIRCULAR_MAX_DOCUMENTS_PER_SCAN, value: "6" }
          - { name: AFTERCIRCULAR_MAX_LLM_CALLS_PER_SCAN, value: "12" }
          - { name: AFTERCIRCULAR_MAX_RETRIES, value: "2" }
          - { name: AFTERCIRCULAR_MAX_CONCURRENT_CALLS, value: "2" }
          - { name: AFTERCIRCULAR_MAX_ESTIMATED_COST_PER_SCAN_USD, value: "0.50" }
          - { name: AFTERCIRCULAR_MAX_ESTIMATED_COST_PER_DAY_USD, value: "5.00" }
          - { name: AFTERCIRCULAR_ENABLE_LIVE_SCAN, value: "true" }
          - { name: AFTERCIRCULAR_ENABLE_SCHEDULED_SCAN, value: "false" }
          - { name: AFTERCIRCULAR_ENABLE_DEMO_RESET, value: "true" }
          - { name: BACKEND_API_KEY, secretRef: backend-api-key }
          - { name: TYPESAFE_API_KEY, secretRef: typesafe-api-key }
          - { name: APPLICATIONINSIGHTS_CONNECTION_STRING, secretRef: appinsights }
          - { name: SEBI_PROXY_URL, secretRef: sebi-proxy-url }
EOF
az containerapp create -g $RG -n aca-aftercircular-api --yaml /tmp/api.yaml && rm /tmp/api.yaml
```

In production the API refuses to start without Foundry, Azure AI Search, `SEBI_MODE=live`, a real backend key, a Jev
key, explicit CORS and a mounted `DATABASE_PATH` — it never degrades to fixtures, the local index or a snapshot.

## 10. The web container app and GitHub sign-in

Create a GitHub OAuth App (Settings → Developer settings → OAuth Apps) with callback
`$WEB_URL/api/auth/callback/github`. A GitHub OAuth App has one callback URL, so use separate apps for local
(`http://localhost:3000/...`) and production.

```bash
az containerapp create -g $RG -n aca-aftercircular-web --environment $ENV \
  --image $ACR.azurecr.io/aftercircular-web:$SHA \
  --user-assigned $WEB_ID --registry-server $ACR.azurecr.io --registry-identity $WEB_ID \
  --ingress external --target-port 3000 --transport auto --min-replicas 1 --max-replicas 3 --cpu 0.5 --memory 1Gi \
  --secrets auth-secret="$AUTH_SECRET" gh-id="$AUTH_GITHUB_ID" gh-secret="$AUTH_GITHUB_SECRET" backend-api-key="$BACKEND_API_KEY" \
  --env-vars NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 BACKEND_URL=http://aca-aftercircular-api AUTH_TRUST_HOST=true \
             AUTH_URL=$WEB_URL AUTH_SECRET=secretref:auth-secret AUTH_GITHUB_ID=secretref:gh-id \
             AUTH_GITHUB_SECRET=secretref:gh-secret BACKEND_API_KEY=secretref:backend-api-key
```

The browser only talks to the web app; its `/api/backend` proxy adds the backend key, the tenant headers and the
signed-in user's GitHub token server-side. Nothing secret is prefixed `NEXT_PUBLIC_`.

## 11. Verify

```bash
WEB_FQDN=${WEB_URL#https://} ./scripts/azure-smoke-test.sh
```

Checks the web ingress, the anonymous redirect, `/health/live` and `/health/ready` (reached from inside the web
container, since the API is internal) and that the API reports `foundry`, `azure-ai-search`, `sebi_mode=live` and
`environment=production`. Then sign in, connect a policy repository (it must contain `aftercircular.yml`; the demo
tenants are [`acme-securities-policies`](https://github.com/auraCodesKM/acme-securities-policies) and
[`nimbus-amc-policies`](https://github.com/auraCodesKM/nimbus-amc-policies)) and press **Scan now**.

## 12. Operating it

| task | command |
|---|---|
| Deploy a new commit | `./scripts/azure-build.sh && GIT_SHA=<sha> ./scripts/azure-deploy.sh` — avoid deploying while a scan runs; a scan interrupted by a restart is marked `FAILED` on start-up and its unfinished publications are retried |
| Logs | `az containerapp logs show -g $RG -n aca-aftercircular-api --tail 100` |
| Relay traffic | `az container logs -g $RG -n aci-aftercircular-sebi-relay` (one line per connection, never credentials) |
| Rollback | `az containerapp update -g $RG -n aca-aftercircular-api --image $ACR.azurecr.io/aftercircular-api:<previous sha>` — the database lives on the share |
| Demo reset | Profile → **Demo controls**: mark a workspace as a demo workspace, then **Reset demo** (owner only, see README) |
| Pause spend | `az containerapp update -g $RG -n aca-aftercircular-{api,web} --min-replicas 0` and `az container stop -g $RG -n aci-aftercircular-sebi-relay` |
| Model usage | Azure Monitor metrics on `$FOUNDRY` (`AzureOpenAIRequests`, `ProcessedPromptTokens`, `GeneratedTokens`) and the dashboard's Usage view |

## Problems we hit, and the fixes

| symptom | cause | fix |
|---|---|---|
| readiness 503 `unable to open database file` | an earlier revision mounted the share without `nobrl`, hung on SQLite's byte-range locks and kept its handles until it was stopped | `nobrl` + uid/gid mount options on every revision; one replica |
| Azure Files cannot be linked to the environment | the CLI created an Express environment | create the environment through ARM with `environmentMode: WorkloadProfiles` |
| live scan `LIVE_FAILED: ConnectTimeout` | SEBI drops TLS from Azure Korea Central | the East Asia relay, used by the SEBI connector only |
| scan fails at *index* with 403 | `get_index` needs Search Service Contributor | grant it (step 7) |
| a scan stuck at `RUNNING` after a deployment | the revision swap stopped the process mid-scan | orphaned scans are failed at start-up; unfinished publications retried |
| `az containerapp exec` fails | it needs a TTY, is rate-limited (429, retry after 600 s) and rejects long `--command`s | the smoke test gives it a pty and uses a single session |
| ACR Tasks not permitted | Azure for Students | build locally with `docker buildx --platform linux/amd64` |

## GitHub Actions

`ci.yml` runs pytest (backend and relay), mypy, `tsc`, ESLint, Vitest, `next build`, both Docker builds and a liveness
check of the API image on every push. `publish-images.yml` pushes to ACR on demand through OIDC (no stored Azure secret).
Deployment stays a human command: a compliance system's only side effect should not ship on a green build.

## Teardown

Deleting in this order removes everything; the Azure Files share holds the database.

```bash
az containerapp delete -g $RG -n aca-aftercircular-web --yes
az containerapp delete -g $RG -n aca-aftercircular-api --yes
az container delete -g $RG -n aci-aftercircular-sebi-relay --yes
az containerapp env delete -g $RG -n $ENV --yes
az group delete -n $RG --yes          # everything else, including Foundry, Search, storage and monitoring
```

## Local production-like run

```bash
cp backend/.env.example backend/.env && cp web/.env.example web/.env.local   # fill in; Azure keys stay empty with Entra ID
AC_UID=$(id -u) AC_GID=$(id -g) docker compose up --build                    # web :3000, api :8010
```

Entra ID inside a container cannot use the host's `az login`; export a dev service principal (`AZURE_TENANT_ID`,
`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) or run the backend on the host with `uv run uvicorn`.
