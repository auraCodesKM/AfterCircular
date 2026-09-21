# AfterCircular — web

Landing page, brand system, auth and the operational dashboard for AfterCircular. Next.js 16 (App Router), TypeScript, Tailwind v4.

Two visual systems, on purpose: the landing/auth/connect pages are editorial (brand tokens `--paper/--ink/--brand`, Glass surfaces);
the authenticated app under `/dashboard` is an application shell built on shadcn/ui (base-nova preset: sidebar, sheet, dialog,
alert-dialog, dropdown-menu, tooltip, table, tabs, card, alert, badge, skeleton, sonner) using the semantic tokens
(`background/foreground/card/muted/accent/border/destructive/success/warning`) with light and dark sets in `app/globals.css`.
Theme: `next-themes` (`class` attribute, `ac-theme` storage key, system default) — scoped to the dashboard layout.
AI presence: `thinking-orbs` (`components/dashboard/orb.tsx` — breathing / searching / working / solving / connecting states, client-only)
and `metal-fx` (`components/dashboard/metal.tsx` — liquid-metal send button and "Jev · System One" tag; falls back without WebGL2).
Markdown (policy sections, memos, summaries) renders through `components/dashboard/markdown.tsx` (react-markdown + remark-gfm, token-styled tables).

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
  dashboard/                     workspace-provider (agent sheet / palette / analysis sheet state), app-sidebar (nav + recent
                                 investigations + workspace + user menu), site-header (breadcrumb, ⌘K), command-palette,
                                 ask-sheet + answer-view (structured agent answers), analysis-sheet + analysis-workspace
                                 (change → decision → evidence → decision path → human-review), scan-control (Scan now, pipeline
                                 readout, friendly failure Alert), status-strip, documents-view/table, review-queue, policies-view,
                                 activity-feed, models-view
app/dashboard/layout.tsx         shell: auth + tenant guard, providers, sidebar, header, agent sheet, palette, analysis sheet, toasts
app/dashboard/{page,documents,documents/[pk],investigations/[id],reviews,policies,activity,models}/page.tsx
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
