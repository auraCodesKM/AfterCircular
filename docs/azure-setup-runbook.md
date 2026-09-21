# AfterCircular — Human Azure Setup Runbook

Goal of this runbook: take you from **"no Azure access on this Mac"** to **"authenticated, read-only discovery possible"**
without spending a single Azure credit. Nothing in here creates, deploys, indexes, embeds, schedules or calls a model.

Legend: 🟢 SAFE / READ-ONLY · 🟡 MAY INCUR COST (only if you later act on it) · 🔴 CAN INCUR COST (never run without approval)
· ⚠️ VERIFY = syntax/facts to check against current Microsoft docs before relying on them.

Machine facts checked on 2026-09-21: Apple Silicon (arm64), Homebrew 6.0.20 present, `uv` present, Docker present,
`az`/`azd` **absent**, no Azure credential of any kind.

---

## 1. What we need

```
Your Mac ──az login──► Azure subscription (Azure for Students)
                           ├── Microsoft Foundry / Azure OpenAI resource ──► model deployment(s)   [AI model service]
                           └── Azure AI Search service                                            [Azure resource]
AfterCircular backend (FastAPI, local for now) ──► reads both via endpoint + key/identity        [application code]
                     └──► Jev (TypeSafe, already live) ──► human approval in the web UI ──► GitHub issue   [external services]
```

| Component | Kind | Status |
|---|---|---|
| Azure CLI (`az`) | local dev tool | to install |
| `uv`, Python, Docker | local dev tools | present (Docker not needed in this phase) |
| Subscription, resource group | Azure account plumbing | unknown |
| Foundry / Azure OpenAI resource + deployments | AI model service (pay-per-token) | unknown |
| Azure AI Search | Azure resource (Free or always-on paid tier) | unknown |
| Storage, Key Vault, App Insights, Container Apps, Functions | Azure resources for *hosting* | **not needed for the first live test** |
| AfterCircular backend + web | application code (this repo) | ready, committed |
| Jev (TypeSafe) | external AI decision service | live-verified |
| GitHub | external service | live (issues #2–#4 exist) |

## 2. Install

Only one tool is required for this phase.

**Azure CLI** — purpose: sign in, list what exists, later run approved commands.

Homebrew is present on this Mac, so:
```bash
brew update && brew install azure-cli
```
Verify:
```bash
az version
```
Official alternative if you prefer not to use Homebrew (macOS installer / script): https://learn.microsoft.com/cli/azure/install-azure-cli-macos

Not needed now: `azd` (Azure Developer CLI — only for template-based deployments), Docker (only when we build the backend
image for Container Apps), Azure Functions Core Tools (only when the timer function is deployed).

## 3. Login  🟢

```bash
az login
```
A browser opens; sign in with the account that owns the **Azure for Students** subscription. If the browser flow fails:
```bash
az login --use-device-code
```
Then:
```bash
az account list -o table
az account show -o table
```
What to look for: a row whose **Name** contains "Azure for Students" (or the subscription you intend to spend from) and whose
**State** is `Enabled`. `az account show` prints the one currently selected (`IsDefault = True`).

Do **not** paste tokens, keys or the raw JSON into Claude. Subscription *names* and *IDs* are not secrets, but you do not need to
paste them either — I will read them with `az account show` myself.

If more than one subscription is listed, select the Students one (**do not run this until you have identified it**):
```bash
az account set --subscription "<SUBSCRIPTION_ID_OR_NAME>"
```

## 4. Verify subscription  🟢

```bash
az account show --query "{name:name, id:id, state:state, tenant:tenantId, user:user.name}" -o table
```
Expect `state: Enabled`. If the Students subscription shows `Disabled` or `Warned`, credits are exhausted or expired — stop here.

## 5. Credit safety  🟢 unless marked

| Check | Command | Label |
|---|---|---|
| Remaining Students credit | Portal → https://portal.azure.com → search **"Education"** → Overview shows remaining credit and expiry. (CLI has no reliable Students-credit command.) | 🟢 |
| Cost so far this month | `az consumption usage list --start-date $(date -v-30d +%F) --end-date $(date +%F) -o table` ⚠️ VERIFY — may return nothing on Students subscriptions; the portal **Cost Management → Cost analysis** blade is the reliable view | 🟢 |
| Everything that exists | `az resource list -o table` | 🟢 |
| Resource groups | `az group list -o table` | 🟢 |
| Things that bill while idle | look in the `az resource list` output for: `Microsoft.Search/searchServices` (any SKU except `free`), `Microsoft.App/containerApps`, `Microsoft.Web/serverFarms` (App Service plans that are not `F1`/`Y1`/Flex), `Microsoft.DBforPostgreSQL/*`, `Microsoft.DocumentDB/*`, VMs, AKS | 🟡 |
| Model deployments (bill per token, not while idle; provisioned-throughput SKUs bill hourly) | §7 | 🟡 |

Fact check from Microsoft docs (verify before relying): Azure AI Search **Free (F)** tier = one per subscription, 50 MB, 3 indexes,
no charge; Basic and above bill hourly whether used or not. Application Insights: first 5 GB/month of ingestion free. Azure OpenAI /
Foundry: pay-per-token on Standard/GlobalStandard deployments, $0 when idle. Availability of Azure OpenAI models on an **Azure for
Students** subscription is not guaranteed (some regions/models need a quota request) — ⚠️ VERIFY in the portal when creating.

## 6. Read-only discovery  🟢

These are the exact commands I will run after you type `DISCOVERY COMPLETE`. All base CLI, no extensions installed.
```bash
az account show -o table
az group list -o table
az resource list -o table                                                                  # everything, one screen
az cognitiveservices account list -o table                                                 # Foundry / Azure OpenAI / AI Services resources
az search service list -o table                                                            # Azure AI Search services
az storage account list -o table
az keyvault list -o table
az resource list --resource-type Microsoft.Insights/components -o table                    # Application Insights (no extension needed)
az resource list --resource-type Microsoft.App/containerApps -o table                      # Container Apps (avoids the containerapp extension)
az functionapp list -o table
az webapp list -o table
```
Services the base CLI cannot list well:
- **Foundry projects** (child resources of an AI Services account): inspect at https://ai.azure.com or
  `az cognitiveservices account show -n <name> -g <rg>` for the parent; ⚠️ VERIFY project listing syntax if needed.
- **Search indexes**: no `az search index` command. Use the REST API with the admin key or the Python SDK with your login —
  `SearchIndexClient(endpoint, DefaultAzureCredential()).list_index_names()` — I will do this from the repo's venv (read-only).

## 7. Foundry discovery  🟢

What we need to learn: resource name, kind (`OpenAI` or `AIServices`), region, endpoint, deployment names, model + version per
deployment, SKU (`GlobalStandard`/`Standard` = per token; `ProvisionedManaged` = hourly 🔴), quota headroom.

```bash
az cognitiveservices account list --query "[].{name:name, rg:resourceGroup, kind:kind, sku:sku.name, region:location, endpoint:properties.endpoint}" -o table
az cognitiveservices account deployment list -g <RG> -n <ACCOUNT> \
  --query "[].{deployment:name, model:properties.model.name, version:properties.model.version, sku:sku.name, capacity:sku.capacity}" -o table
az cognitiveservices usage list -l <REGION> -o table                                       # quota per model family in that region
```
Never `az cognitiveservices account keys list` in a Claude session — keys stay in your terminal / `backend/.env` only.

Reuse rule: any existing deployment of a chat model (gpt-4.1-mini / gpt-4o-mini / gpt-4.1 / gpt-4o / gpt-5-mini …) works for
**all three logical tasks** (extraction, reasoning, memo) by setting the three `*_MODEL` variables to the same name. An embedding
deployment (`text-embedding-3-small`, 1536 dims) is needed for vector search; without it retrieval degrades to keyword-only.

**FOUNDRY CREATION PLAN — only if nothing exists; do not execute** 🔴 (per-token cost after creation, $0 idle)
```bash
az group create -n rg-aftercircular -l <REGION>                                                   # 🟢 free container
az cognitiveservices account create -n <ACCOUNT> -g rg-aftercircular -l <REGION> --kind OpenAI --sku S0 --custom-domain <ACCOUNT>   # 🟡 $0 idle
az cognitiveservices account deployment create -g rg-aftercircular -n <ACCOUNT> --deployment-name gpt-4.1-mini \
  --model-name gpt-4.1-mini --model-version <VERSION> --model-format OpenAI --sku-name GlobalStandard --sku-capacity 10        # 🟡 per token
az cognitiveservices account deployment create -g rg-aftercircular -n <ACCOUNT> --deployment-name text-embedding-3-small \
  --model-name text-embedding-3-small --model-version 1 --model-format OpenAI --sku-name Standard --sku-capacity 10            # 🟡 per token
```
⚠️ VERIFY: region and `<VERSION>` from the portal's model catalog for your subscription; one chat deployment is enough to start —
a second (stronger) reasoning deployment is optional and only justified after measuring.

## 8. Search discovery  🟢

```bash
az search service list --query "[].{name:name, rg:resourceGroup, sku:sku.name, region:location, status:status, replicas:replicaCount, partitions:partitionCount}" -o table
az search service show -n <NAME> -g <RG> -o jsonc                                          # full config (no keys printed)
```
Endpoint is `https://<NAME>.search.windows.net`. Indexes: SDK/REST as in §6. Vector search is available on all current tiers
including Free (⚠️ VERIFY current limits on the Free tier: 50 MB, 3 indexes).

**MINIMAL SEARCH CREATION PLAN — only if none exists; do not execute**
```bash
az search service create -n <NAME> -g rg-aftercircular -l <REGION> --sku free              # 🟢 $0 if Free is available to the subscription
```
If the CLI returns an error that the Free tier is unavailable/exhausted (one per subscription), **stop** — Basic is 🔴 always-on
billing and needs a separate decision. Alternative with zero Azure cost: keep the built-in `LocalRetriever` (hybrid BM25 + cosine
in-process) for the first live test; it is functionally the same interface.

## 9. Minimal architecture

**REQUIRED for the first live demo** (proves SEBI → extraction → retrieval → Jev → impact → memo → approval → GitHub issue):
1. One Foundry/Azure OpenAI resource with **one chat deployment** (+ one embedding deployment if vector search is wanted).
2. Azure AI Search **Free** — or `LocalRetriever` if Free is unavailable (documented, still hybrid).
3. Backend running **locally** (`uv run uvicorn …`), SQLite on disk, Jev key, GitHub OAuth — all already present.

**OPTIONAL / later** (hosting, not AI): Storage account (Azure Files for SQLite), Key Vault, Application Insights, Container Apps,
Functions timer. None of them is needed to prove the pipeline; all of them are documented in `azureDecision.md` §14 for phase 2.

| Service | Need now? | Skip for first test? | Ongoing cost | Add when |
|---|---|---|---|---|
| Storage | no | yes | cents | backend moves to Container Apps |
| Key Vault | no | yes | cents per 10k ops | backend moves to Azure (secrets as references) |
| Application Insights | no (logs already carry tokens/cost) | yes | free ≤ 5 GB/mo | you want a dashboard for the demo — cheap, add second |
| Container Apps / Functions | no | yes | consumption / free grant | after local live tests pass |

## 10. Missing-resource decision tree (after discovery)

```
Foundry/Azure OpenAI resource exists?      ── yes ─► reuse (record name/region/endpoint)
                                           └─ no ──► show §7 creation plan + cost line ─► STOP, ask
Chat deployment exists?                    ── yes ─► reuse for EXTRACTION/IMPACT/MEMO (same name is fine)
                                           └─ no ──► propose ONE mini deployment ─► STOP, ask
Embedding deployment exists?               ── yes ─► reuse (check dims = 1536)
                                           └─ no ──► propose text-embedding-3-small, or keyword-only ─► STOP, ask
Search service exists?                     ── yes ─► reuse (any SKU; note if it bills while idle)
                                           └─ no ──► propose Free tier; if unavailable → LocalRetriever ─► STOP, ask
Anything else (storage/KV/insights/apps)   ── not needed for the first test; listed only for inventory
```
Every "STOP, ask" is a separate approval. A generic "yes" is not treated as approval for anything not named.

## 11. Environment variables (`backend/.env`, git-ignored)

NON-SECRET (fine to discuss in chat):
```
AI_PROVIDER=foundry
FOUNDRY_ENDPOINT=https://<ACCOUNT>.openai.azure.com      # or https://<ACCOUNT>.services.ai.azure.com for AI Services kind
FOUNDRY_API=responses
EXTRACTION_MODEL=<chat deployment name>
IMPACT_MODEL=<chat deployment name>                     # same deployment is acceptable
MEMO_MODEL=<chat deployment name>
EMBEDDING_MODEL=<embedding deployment name>              # leave as is / unused if keyword-only
AZURE_SEARCH_ENDPOINT=https://<NAME>.search.windows.net  # empty → LocalRetriever
ENVIRONMENT=dev
AFTERCIRCULAR_MAX_DOCUMENTS_PER_SCAN=1
AFTERCIRCULAR_MAX_LLM_CALLS_PER_SCAN=10
AFTERCIRCULAR_MAX_RETRIES=2
AFTERCIRCULAR_MAX_CONCURRENT_CALLS=2
AFTERCIRCULAR_ENABLE_SCHEDULED_SCAN=false
```
SECRET (type them into `backend/.env` yourself; never into chat):
```
FOUNDRY_API_KEY=            # optional — leave EMPTY to use your az login identity instead (§12)
AZURE_SEARCH_API_KEY=       # optional — leave EMPTY to use your az login identity if you have the Search data roles
TYPE_SAFE_API_KEY=          # already set
GITHUB_TOKEN=               # only for scheduled scans; not needed now
```
With identity-based auth both `*_API_KEY` lines stay empty and there is nothing secret to manage locally.

## 12. Authentication

**Development (now):** `DefaultAzureCredential` — the backend and `scripts/live_check.py` pick up your `az login` session
automatically when `FOUNDRY_API_KEY` is empty. Requirements: your user needs **Cognitive Services OpenAI User** on the Foundry
resource (owners of a Students subscription usually have it via Owner/Contributor — ⚠️ VERIFY: data-plane roles are separate
from Contributor on some resources; if the first call returns 401/403, either assign the role 🟢 or fall back to the key).
For Search with identity: **Search Index Data Contributor** + **Search Service Contributor** on the service (RBAC must be enabled on
the service: `az search service update -n <NAME> -g <RG> --auth-options aadOrApiKey` ⚠️ VERIFY flag name).

**Production/hosted (later):** Container App system-assigned **managed identity** + the same RBAC roles; secrets that cannot be
identity-based (BACKEND_API_KEY, TYPE_SAFE_API_KEY, GITHUB_TOKEN) as **Key Vault references**. No keys in app settings.

## 13. Return-to-Claude-Code command

When `az account show` prints the right subscription, come back and type exactly:

```
DISCOVERY COMPLETE
```

## 14. What Claude Code does next

Runs **only** §6–§8 read-only commands (plus the SDK index listing), makes **no** model calls, creates nothing, and reports in this
shape — every line filled from real output or marked NOT FOUND / NOT VERIFIED:

```
AZURE SUBSCRIPTION   name · id (last 4) · state · tenant (last 4)
RESOURCE GROUP(S)    name · region
FOUNDRY RESOURCE     name · kind · sku · region · endpoint · NOT FOUND
FOUNDRY DEPLOYMENTS  deployment · model · version · sku · capacity  (per row) · NOT FOUND
AI SEARCH            name · sku · region · endpoint · indexes · NOT FOUND
STORAGE              name · sku · region · NOT FOUND
KEY VAULT            name · region · NOT FOUND
APP INSIGHTS         name · region · NOT FOUND
CONTAINER APPS       name · region · NOT FOUND
FUNCTIONS            name · plan · region · NOT FOUND
```
Then it **stops** and asks:

```
AZURE DISCOVERY COMPLETE.
No resources were created. No model calls were made.

Here is what exists: …
Here is what is missing: …
Here is the estimated cost impact: … (FREE / FIXED / PAY-AS-YOU-GO / ESTIMATE / UNKNOWN per line)

Approve provisioning? YES/NO
If YES, which resources? (name each: e.g. "resource group", "Foundry resource", "gpt-4.1-mini deployment", "embedding deployment", "Search Free")
```
Only the resources you name are created, one command each, with the output pasted into `azureDecision.md` §15.

## 15. Cost-control rules (unchanged, enforced in code)

- Discovery: **0 model calls**. Live tests only after your explicit "approve live tests": TEST 1 smoke → 2 extraction → 3 embedding →
  4 Search query → 5 Jev → 6 impact → 7 memo (only if CONFLICT) — **one call each, stop on first failure**.
- `MAX_DOCUMENTS_PER_SCAN=1`, `MAX_LLM_CALLS_PER_SCAN=10`, `MAX_RETRIES=2`, `MAX_CONCURRENT_CALLS=2`, scheduled scans off.
- No corpus embedding, no Search indexing, no eval suite, no model comparison, no second Foundry resource, no Basic Search
  without a named approval.
- Stub provider is refused outside `ENVIRONMENT=dev`; a failure is reported as the failing provider, never papered over.
