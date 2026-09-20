# AfterCircular — web

Landing page, brand system, auth and the operational dashboard for AfterCircular. Next.js 16 (App Router), TypeScript, Tailwind v4, shadcn/ui (badge, dialog, tabs, table) on top of the brand's Glass surfaces.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm run start
npm run lint
```

## Layout

```
app/
  page.tsx            landing page (server component)
  signin/  signup/    auth pages — placeholder server actions in components/auth/actions.ts
  icon.svg            favicon (same geometry as public/brand/aftercircular-favicon.svg)
  apple-icon.tsx      180px PNG generated from the mark
components/
  brand/aftercircular-logo.tsx   <Mark /> and <Logo />, animated variant, reduced-motion aware
  landing/hero.tsx + hero.css    full-viewport stage: CloudFront background video, Inter masthead with
                                 LED-dot "action", three rigid 429×554 glass cards (--u unit scaling),
                                 one-shot entrance choreography (html.entrance-active)
  landing/dot-type.tsx           7-row bitmap LED glyphs → SVG circles (server-rendered)
  landing/hero-art.tsx           gauge / tile-wall + glass window / connections map SVGs
  landing/                       problem, workflow, evidence, model-intelligence, security,
                                 responsible-ai, final-cta, footer, nav
  auth/                          auth shell, form, server-action stubs
  ui/                            button, input, section, reveal (the only client component besides the auth form)
  dashboard/                     dashboard (Scan now, live steps, review queue, activity, model intelligence), review-dialog
app/dashboard/page.tsx           server component: loads the snapshot from the backend, renders <Dashboard/>
app/api/backend/[...path]        authenticated proxy → FastAPI (adds API key, tenant headers, user's GitHub token)
lib/backend.ts                   server-only backend client · lib/pipeline-types.ts mirrors backend schemas
lib/model-evals.ts               typed slot for Foundry evaluation results; empty until measured
public/brand/                    mark, animated mark, logo, favicon (SVG)
```

## Auth + GitHub connection

Auth.js v5 with the GitHub provider (`auth.ts`). Flow: `/signin` → GitHub OAuth → `/connect` (name the company, pick the
policy repository; access re-verified server-side) → `/dashboard`. One tenant per GitHub user for now; the backend
partitions everything by `tenantId`.

1. GitHub → Settings → Developer settings → OAuth Apps → New. Callback URL `http://localhost:3000/api/auth/callback/github`.
2. `cp .env.example .env.local`, fill `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`, generate `AUTH_SECRET` with `npx auth secret`.
3. `npm run dev`.

Tenant state: with `BACKEND_URL` + `BACKEND_API_KEY` set, the FastAPI backend owns it (`PUT /api/tenants`,
`GET /api/tenants/by-owner/:githubId`). Without them, a dev-only JSON file at `data/tenants.json` (git-ignored) is used;
production builds refuse it unless `ALLOW_JSON_TENANT_STORE=true`.

Azure: set the same variables as App Settings (or Key Vault references), plus `AUTH_TRUST_HOST=true`; register the
production callback URL on the OAuth App. The OAuth token lives only in the encrypted session JWT and is read
server-side.

## Rules baked in

- No fabricated numbers. `24/7`, `100%`, `1 gate` are capability statements. The evaluation table renders a pending state until `lib/model-evals.ts` has measured rows.
- All animation is CSS/SVG and disabled under `prefers-reduced-motion`.
