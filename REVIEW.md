# Antigravity Threads — Code Review

> Source review performed on `eager-raman` (Antigravity Threads v2.7), a Next.js 16 + Supabase + Gemini + Replicate/HF wardrobe / stylist app.
> Date: 2026-07-10.
> Scope: bug fixes, tech debt, security, UI/UX, enhancements.

---

## 🐞 Bugs

### High severity

1. **AuthGate `window.fetch` proxy is leaked on sign-out / double-wrapped** — `src/components/AuthGate.tsx:26-43` and `:51-67`. Both `getSession` and `onAuthStateChange` install `window.fetch = new Proxy(window.fetch, ...)`. After the first call `window.fetch` *is* a proxy, so the second call wraps the proxy in another proxy (double header injection). On sign-out, `onAuthStateChange` fires with `null` session but no branch resets `window.fetch`, so subsequent requests still receive the proxy with a stale/undefined Bearer token.
   *Fix*: Install the proxy exactly once via a ref, refresh on token rotation, and clear on sign-out.

2. **Garments inserted without `user_id`, breaking multi-user isolation** — `src/app/api/upload/route.ts:23-46`, `src/app/api/ingest/batch-process/route.ts:357-372`, `src/app/api/items/wear/route.ts:30-38`, `src/app/api/telemetry/route.ts:24-36`. These all use the **admin** client (`supabase`, no per-request JWT). After `migration_multiuser.sql`, `user_id` defaults to `auth.uid()` which is `NULL` for the service-role client, so rows are created with `user_id = NULL` and are invisible to all real users under RLS.
   *Fix*: Centralize a `getUser(request)` helper that pulls the JWT from the `Authorization` header, resolves the user via Supabase, and rejects unauthenticated writes.

3. **`PATCH /api/items` allows mass-assignment of any column** — `src/app/api/items/route.ts:34-50`. The destructure strips `images`, `primary_image_url`, `garment_images`, but then `.update({ ...updates, updated_at })` writes everything else, including `user_id`, `status`, `ai_extracted_json`, `id`, `created_at`.
   *Fix*: Maintain an explicit allowlist of updatable columns and validate types.

4. **SSRF in `/api/items/add-image` and `/api/items/search-image`** — `src/app/api/items/add-image/route.ts:23-32` and `:215-222` (PUT). Both accept an arbitrary `imageUrl` from the client and `fetch()` it. A user can point at `http://169.254.169.254/latest/meta-data/iam/security-credentials/`, internal Supabase admin endpoints, or any internal service. No URL allowlist or DNS pinning.
   *Fix*: Resolve the hostname, reject private IP ranges (RFC1918, `169.254.0.0/16`, `100.64.0.0/10`, `::1`, link-local), only allow HTTPS to a public CDN.

5. **MCP `add_garment_to_inventory` accepts arbitrary `image_url`** — `src/app/api/mcp/route.ts:138-196`. The MCP tool can insert any `image_url`, which is then fetched by Gemini. Combined with the SSRF above, this becomes a bearer-token-authenticated way to make the server fetch arbitrary URLs.

6. **Local Python fallback can't run in production** — `src/app/api/ingest/batch-process/route.ts:288-320` and `src/app/api/upload/cutout-server/route.ts:117-169`. They use `execSync('python3 ...')` with a hardcoded macOS path `/Library/Frameworks/Python.framework/Versions/3.13/bin/python3`. This won't work on Vercel serverless (no filesystem access, no Python runtime, no `/tmp` persistence). Silently fails.
   *Fix*: Move behind a feature flag (`BG_REMOVAL_LOCAL_ENABLED`) and document that it only runs in self-hosted deployments.

### Medium severity

7. **Parallel Gemini calls with no concurrency cap** — `src/app/api/ingest/batch-process/route.ts:414`. `Promise.all(processingPromises)` fires every garment simultaneously. A 20-item batch triggers 20 concurrent Gemini-2.5 calls — likely to trip rate limits (60 RPM on Flash-Lite) and inflate billing.
   *Fix*: Use `p-limit(5)` or a semaphore-style queue.

8. **`upload/cutout` silently overwrites the primary image** — `src/app/api/upload/cutout/route.ts:50-58`. Replacing the primary `storage_path` with the cutout means the raw wide-shot is lost unless it was registered as a non-primary detail.
   *Fix*: Insert cutout as a new row (optionally replacing `is_primary_profile`), never `update` the existing primary's `storage_path`.

9. **`/api/items/merge` and `/api/items` (DELETE) use O(N×M) cleanup and no transaction** — `src/app/api/items/route.ts:126-141`, `src/app/api/items/merge/route.ts:64-81`. Each delete pulls every `saved_outfit`, mutates it row-by-row in a loop, and is not wrapped in a transaction. Partial failure leaves inconsistent state.
   *Fix*: Wrap in a Postgres function or use `supabase.rpc()`.

10. **`/api/items/wear` is a CPW-cheat surface** — `src/app/api/items/wear/route.ts:22-38`. No idempotency, no dedup, no date constraint. A user (or compromised client) can POST 10,000 wear logs in a second and drive CPW to $0.0001.
    *Fix*: Add a unique `(garment_id, worn_date)` constraint server-side and reject duplicates with 409.

11. **Stale closure on `items` in batch upload** — `src/app/page.tsx:909`. `items.find(...)` reads from the closure taken at the start of the function. After `await fetchItems()`, the local `items` is stale.
    *Fix*: Re-fetch and compute `validationTarget` from the returned `data.item`.

12. **Telemetry route orders by `timestamp`** — `src/app/api/telemetry/route.ts:11`. Column name unverified; if it's `created_at` the query fails.
    *Fix*: Confirm column name; add migrations for all tables.

13. **VTON route can exceed Vercel timeouts** — `src/app/api/outfits/virtual-try-on/route.ts:84`. `maxDuration = 60` is set, but Replicate predictions often take 30–90 s and the poll loop runs up to 60 s. Hobby tier is capped at 10 s.
    *Fix*: Make this a background job + polling endpoint.

### Low severity

14. **`compressImage` always re-encodes to JPEG** — `src/app/page.tsx:706-756`. Transparency is destroyed; the cutout flow later depends on transparent PNGs.
15. **`Math.random` for mock weather** — `src/app/api/weather/route.ts:117-123`. Mock condition regenerates per request if cache fails, leading to UI flicker.
16. **`touchStart/touchCurrent/isSwiping` declared but never wired** — `src/app/page.tsx:124-126`. Dead state or missing swipe handlers.
17. **`upsert: true` on raw uploads** — `src/app/api/upload/route.ts:71`. Same-millisecond collisions silently overwrite. Use `upsert: false` and handle 409.

---

## 🧱 Tech Debt

### Architecture

- **`src/app/page.tsx` is 5,281 lines** — a single client component containing every tab, every modal, every handler, and every prompt. Split into ~20 components in `src/components/`.
- **No `src/types/`** — interfaces live at the top of `page.tsx`. Move to `src/types/db.ts` and `src/types/api.ts`.
- **No state management** — 40+ `useState` hooks in one component. Introduce **Zustand** for cross-tab state and **TanStack Query** for server state.
- **Two parallel DB schemas** — `supabase_schema.sql` defines `wardrobe_items` (public RLS); `migration_multiuser.sql` defines `garments` (auth-based RLS). Code uses `garments`. The first is dead — delete it or fold the public-access setup into README.
- **Inconsistent Supabase usage** — some routes use admin `supabase`, others `getSupabaseClient(request)`. Pick one.
- **No API error shape standard** — routes return `{ error }` / `{ success, error }` / `{ error, items }` inconsistently. Define a `Result<T>` type.

### Code quality

- **Hardcoded magic strings everywhere** — `'Active'`, `'Processing'`, `'Processing_Failed'`, `'profile'`, `'detail'`, `'gemini-flash-lite-latest'`. Promote to `src/lib/constants.ts`.
- **Repeated storage bucket name** — `'wardrobe-images'` appears in 8+ files. Constants please.
- **Gemini prompts inlined in route handlers** — move to `src/lib/prompts/*.ts` so they can be versioned and A/B tested.
- **No structured logger** — `console.log`/`console.error` with no levels, no context. Adopt `pino`.
- **No env var validation** — missing keys fail at runtime. Use `zod` in `src/lib/env.ts`.
- **No type for `metadata` in telemetry** — `Record<string, any>` everywhere.

### Tooling

- **Zero tests** — no Vitest, Jest, Playwright. No fixtures.
- **Minimal ESLint config** — no `jsx-a11y`, no `next/security`, no Prettier.
- **No CI** — `git status` is clean; no GitHub Actions, no preview deploys.
- **`@gradio/client` and `@huggingface/transformers` are heavy deps** — listed in `package.json` but not used in the routes I've read. Likely dead deps in the bundle.

---

## 🔒 Security

### Critical

1. **`wardrobe_items` table has fully permissive RLS** — `supabase_schema.sql:23-42`. Every row in the (legacy) `wardrobe_items` table can be SELECT, INSERT, UPDATE, DELETE by **anyone** with the anon key.
2. **`wardrobe-images` storage bucket is set to public** — README tells users to mark it public. Photos of personal clothing are world-readable.
3. **No authentication on most mutation routes** — `/api/upload`, `/api/ingest/batch-process`, `/api/items/wear`, `/api/telemetry`, `/api/items/search-image`, `/api/items/add-image`, `/api/outfits/generate-image`. Anyone can POST and burn Gemini/Remove.bg/HF quota.
4. **MCP bearer token has no audit and no rotation** — `src/app/api/mcp/route.ts:80`. Leaked token = permanent access to "delete any garment".

### High

5. **Chat panel stores user API keys in `localStorage`** — `src/app/page.tsx:158-162` and sends them to `/api/chat`. Any XSS reads them.
6. **No CSRF protection on state-changing routes** — Next.js doesn't include CSRF by default.
7. **No rate limiting on `/api/ingest/batch-process`** — costs real money per call.
8. **Image upload validation is MIME/extension only** — `src/app/api/upload/route.ts:54-62`. Bytes are not validated. A `.png` polyglot could embed HTML/JS that fires when the public URL is loaded.
9. **No max file size server-side** — only browser-side `compressImage` caps dimensions.

### Medium

10. **Service worker caches everything by default** — `public/sw.js` uses cache-first with no path filtering. Logged-in user responses can leak across sessions on shared devices.
11. **`/api/items/set-primary-image` lacks ownership check** — any caller can flip any garment's primary image.

---

## 🎨 UI / UX

### High-impact

1. **Replace `alert()` / `confirm()` with a design-system dialog** — ~10 sites use native browser alerts. Breaks the immersive aesthetic and is inaccessible.
2. **Loading skeletons** — `loadingItems` toggles a spinner; the grid goes empty → populated with no transition.
3. **Empty states** — no onboarding when `items.length === 0`.
4. **Focus management in modals** — no focus trap, no focus restore, no keyboard dismissal.
5. **Tab nav not mobile-friendly** — Five tabs will overflow on mobile. Add a bottom tab bar on small screens.
6. **Form accessibility** — AuthGate labels aren't associated via `htmlFor`/`id`.
7. **Color-only status indicators** — Add text/icon to color pills for color-blind users.
8. **Icon-only buttons without `aria-label`** — delete image, close modals, "set primary" star.
9. **Keyboard shortcuts** — Esc, `/`, `?`, Cmd+K.
10. **Toast notifications** — non-blocking feedback for save success.

### Polish

- **Undo for destructive actions** — delete is permanent. Add a trash bin.
- **Bulk edit on grid view** — only matrix view supports multi-select.
- **Inline expand on garment cards** — show CPW, fabric blend, notes preview on hover/tap.
- **Better chat positioning** — may overlap floating cutout progress / modal buttons.
- **Spreadsheet column resize / reorder**.
- **Touch swipe between outfit cards** — `touchStart`/`touchCurrent` state exists but no swipe handler is wired up.
- **Image compression feedback** — silent 1000×1000 resize.
- **Drag-to-reorder saved outfits**.

---

## ✨ Enhancements

### Quick wins (1–3 days each)

1. Refactor `page.tsx` into focused components.
2. Add `supabase/migrations/` directory.
3. `p-limit` for Gemini batching.
4. Standardize API responses.
5. `/api/health` route.
6. Persist chat conversations.
7. Sentry (or similar).
8. Request-ID propagation.
9. "Try again" affordance on `Processing_Failed` items.
10. CPW sparkline on garment detail.

### Medium features (1–2 weeks each)

11. TanStack Query for server state.
12. Zustand for UI state.
13. Outfit calendar view.
14. Packing list generator.
15. Auto-categorization rules.
16. Outfit sharing via public link.
17. Brand suggestion engine.
18. CSV/JSON/PDF export.
19. Color analysis.
20. Carbon/sustainability scoring.

### Larger features (3+ weeks)

21. Offline-first ingestion (IndexedDB + Service Worker rewrite).
22. Multi-language support (i18next).
23. Stripe-billed premium tier.
24. Web Push notifications.
25. AR virtual try-on.

### Tooling / DevEx

26. Vitest + React Testing Library.
27. Playwright E2E.
28. GitHub Actions (lint → typecheck → test → build → preview).
29. Storybook.
30. OpenAPI spec from Zod.

---

## ⏱️ Effort estimates

> Person-days (pd). 1 pd = 6 focused hours.

| Wave | Scope | pd |
|---|---|---|
| **Wave 1 — Critical bugs + small fixes** (top-10 #10, #3, #5, #4, #7-allowlist) | Schema cleanup, AuthGate proxy, p-limit, SSRF util, PATCH allowlist | **~1.5 pd** |
| **Wave 2 — Medium security + UX** (top-10 #1+#2, #7-responses, #8) | Auth on mutating routes, response helper, Dialog component | **~3 pd** |
| **Wave 3 — Large refactors** (top-10 #6, #9) | `page.tsx` split, Vitest setup + first tests | **~10–15 pd** |
| **Top 10 total** | | **~14–19 pd (~3–4 weeks for one dev)** |

Full review (all bugs + tech debt + all enhancements): **~30–45 pd (~6–9 weeks for one dev)** if pursued end-to-end.

If prioritizing only the critical security + multi-user-correctness items (auth, RLS, PATCH allowlist, SSRF): **~3–4 pd**.