# Wardrobe Studio — Agent Handoff

Last updated: 2026-07-15

This is the durable context file for a new coding agent. Read it before changing the app. Do not rely on chat history for product decisions, credentials, or deployment state.

**Read [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md) immediately after this file.** It is the authoritative product scope, recovery backlog, legacy-capability inventory, data-preservation contract, and acceptance criteria. This file is intentionally focused on technical environment and deployment context.

## Product in one sentence

Wardrobe Studio turns a user's outfit photos (phone, local files, or Google Photos Picker) into an approved digital closet with source-grounded, clean catalog cutouts, then uses that closet for outfit planning and future try-on renders.

## Repositories and environments

- Local repository: `/Users/toddtrevisan/Documents/Codex/wardrobe-studio`
- GitHub: `TMTrevisan/Wardrobe-Studio` (work is pushed directly to `main`)
- Production alias: `https://wardrobe-studio-mu.vercel.app`
- Supabase project ref: `hstmcqdktegxoucddyag`
- Vercel team/project: `tmtrevisan-projects / wardrobe-studio`

Never write API keys into this repository or into this file. Environment variables belong in Vercel and `.env.local`, which must remain untracked. API credentials were shared in an earlier chat and should be rotated if they have not already been rotated.

## Current architecture

```text
Phone / local files / Google Photos Picker
  -> Supabase Storage import asset
  -> Gemini vision analysis (person + garment bounding boxes + metadata)
  -> user review/approval
  -> padded source_crop saved in Supabase Storage
  -> GPT Image 2 edit (one garment, chroma background)
  -> Sharp chroma removal + simple QA
  -> catalog_cutout stored in Supabase Storage and shown in closet
```

- **Gemini** is the inexpensive/high-volume vision stage. It detects garments and suggests category, color, and tags. It must never auto-create wardrobe items without user approval.
- **GPT Image 2** reconstructs an approved crop into a polished product image. The prompt is deliberately evidence-bound: preserve only visible garment details and do not invent logos or construction.
- **Sharp** removes the model-generated solid chroma background locally/server-side. This is deterministic and avoids a separate background-removal service.
- **Supabase** owns user data, Storage, provenance, detected garments, assets, and job records. Keep all user-owned tables and buckets behind RLS; never expose a service role key to the browser.

Primary implementation paths:

- `src/app/api/imports/route.ts` — file upload and duplicate import handling
- `src/app/api/imports/[id]/analyze/route.ts` — Gemini intake analysis
- `src/app/api/detections/approve/route.ts` — approve detections and create source crops/items
- `src/app/api/catalog/generate/route.ts` — GPT edit, chroma removal, asset/job persistence
- `src/lib/ai/catalog.ts` — model, quality/size defaults, prompt, chroma key selection
- `src/components/studio/` — Studio UI, review flow, Google Photos button, garment drawer
- `supabase/migrations/20260715000000_wardrobe_studio_pipeline.sql` — current additive Studio schema

## Cost policy (current)

Default catalog reconstruction is now intentionally conservative:

- Model: `gpt-image-2`
- Quality: `low`
- Canvas: `816x816`
- Why: 816 x 816 is the smallest supported square canvas for GPT Image 2 (dimensions must be multiples of 16 and contain at least 655,360 pixels). The app displays small catalog tiles, so 1024 x 1024 is unnecessary as the default.
- Important: the input crop is still sent at GPT Image 2's fixed high input fidelity, so shrinking output reduces output cost only. It does not make the source crop cheaper.

The defaults are configured in `src/lib/ai/catalog.ts` and can be overridden without code changes:

```env
OPENAI_IMAGE_QUALITY=low
OPENAI_CATALOG_IMAGE_SIZE=816x816
```

Use `medium` only for a manual regenerate of an important garment. Do not use `high` for grid thumbnails. Preserve source crops and generated assets; never silently regenerate a completed item, because each attempt is billable.

## Cost-aware roadmap

1. **Stabilize the immediate path** — validate a small batch (5–10 approved crops) using the new low/816 defaults. Confirm cutouts, source crops, and item images all appear reliably.
2. **Generation ledger and spending controls** — add estimate, provider/model/quality/size, actual API usage when available, per-run cap, and explicit approval before paid batches. `processing_jobs` already stores job status and model/input metadata.
3. **True asynchronous Batch API** — current “batch” is a concurrency-limited sequence of individual Image Edit calls, not discounted OpenAI Batch API. Add a queued/polling workflow for overnight catalog jobs before claiming the Batch discount in the UI.
4. **Re-render controls** — a per-garment Medium-quality “improve result” action, preserving previous catalog assets. Never overwrite the only good asset.
5. **Provider evaluation** — benchmark 20–50 identical source crops against Gemini image options before switching generation providers. Keep Gemini vision regardless. Optimize for garment identity, edges, fabric, graphics, and failure rate—not only raw price.
6. **User pricing/billing** — when the product is ready for multiple users, price against stored generation costs, restrict paid generations by account/budget, and add a billing provider. This is explicitly future work, not implemented.

## Recent fixes and known behavior

- **Asset visibility is the immediate next release:** production data verification found 119 garments, 230 legacy image records, 6 original import photos, 5 Studio source crops, and 9 each of chroma/cutout images. These are retained in Supabase but mostly invisible in the current Studio's one-image drawer. Read "Next implementation sequence" in `PRODUCT_BRIEF.md`; Release A must precede further large-scale generation.
- **Catalog request contract verified against official docs 2026-07-15:** GPT Image 2 Image Edit returns `data[0].b64_json` by default. Do not send `response_format` to the deployed Image Edit endpoint; it returned `400 unknown parameter: response_format` in production.
- **Mobile upload 413 verified in Vercel logs:** the Studio picker now client-compresses selected phone images before its server-proxied request and renders a clear non-JSON/413 error. Direct authenticated Storage uploads remain the required long-term mobile ingestion design.
- **New intake display names:** new detection approvals now use `Brand + Color + Subcategory` when evidence supports a brand; brand is intentionally omitted when not visible. Existing names are not bulk-rewritten.

- **Production pipeline verified 2026-07-15:** a supplied outfit photo completed upload → Gemini detection → approval → source crop → GPT Image → chroma removal → persisted catalog cutout. The verification result was HTTP 200, a signed catalog URL, `garment.catalog_status = ready`, `processing_jobs.status = succeeded`, and a valid 816×816 PNG with QA `passed`.
- **Approval retries are idempotent:** `POST /api/detections/approve` now returns already-approved garments for the same selected detection IDs. It must not filter them out and respond “No garment crops could be created.”
- **Storage binary rule:** Server-generated Sharp buffers must be uploaded as `File` objects via `toStorageFile` in `src/lib/image/upload-body.ts`. Passing a Node `Buffer` corrupted JPEG bytes; passing an ArrayBuffer stored the literal text `[object SharedArrayBuffer]`. The accompanying regression test verifies byte preservation. Use this helper for future server-generated image uploads.
- **Catalog asset schema rule:** both catalog assets need non-null schema fields. `catalog_chroma` requires `is_primary: false` and `qa_json: {}`; `catalog_cutout` needs `is_primary: true` and actual QA metadata. Keep catalog route error stages explicit so database failures are not reported as generic model failures.
- **Known intake limitation:** Vercel rejected one large re-encoded mobile photo with HTTP 413 before the app’s 25 MB validation. Replace the server-proxied import with direct-to-Supabase Storage signed uploads (or client-side resize/compression) before marketing full-resolution camera-roll ingestion.
- Duplicate imports now return the existing import rather than creating a second import.
- Reopening an analyzed import returns its existing detections rather than incorrectly saying no photos remain.
- A GPT billing hard-limit/quota error is surfaced as a clear `402` response. It is not a source-image failure.
- A catalog request without a retained source crop is disabled/blocked rather than retrying an image that cannot be read.
- Generated catalog images and source crops are persisted in Supabase Storage; they should survive refreshes and cross-device use.
- Google Photos uses the post-2025 Picker flow, which requires explicit user choice. It does not receive broad camera-roll access.

Recent production symptoms that need re-testing after each deploy:

- Google Photos previously opened a blank screen; check Google Cloud authorized origins, Picker configuration, and browser console/network logs.
- The Studio menu (three dots), item image display, and “Add to wardrobe” behavior were reported unreliable. Verify visually on production with a real signed-in user before considering the flow done.
- Several early images were broken because old rows lacked retained source crops; new approval flow should save `source_crop` assets.

Next product redesign work requested by the user (not yet implemented):

- Restore a **multi-photo garment intake**: group front/back/detail/tag/fabric/size/brand shots under one garment, keep each provenance asset, and use the best front image as the catalog reconstruction source.
- Add a mobile-first **sidebar/navigation** redesign.
- Add generation estimates, an enforceable daily spending cap, and a durable generation ledger before enabling larger automatic batches.

## Required environment variables

Server-only:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- optional `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, `OPENAI_CATALOG_IMAGE_SIZE`
- optional legacy `SUPABASE_SERVICE_ROLE_KEY` only where explicitly required by server-side legacy jobs

Public/browser:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`

Do not confuse `GOOGLE_API_KEY` with the OAuth client ID. Google Photos Picker needs the OAuth web client ID; Gemini needs `GEMINI_API_KEY`.

## Verification before handoff/deploy

```bash
npm test
npm run typecheck
npm run build
git status --short
```

Then verify the full production story manually:

1. Sign in on desktop and mobile.
2. Upload one outfit photo from the phone.
3. Analyze, review detections, and approve only real pieces.
4. Confirm source crops are visible in the review/drawer.
5. Generate exactly one catalog item first; check job status, final cutout, and source crop.
6. Only then run a small bulk generation batch.
7. Test Google Photos Picker in a real browser session.

## Working conventions

- Use `apply_patch` for edits. Preserve unrelated user changes.
- Run focused tests plus typecheck/build after implementation work.
- Push intentional commits to `main` only after validation.
- Avoid destructive Git operations.
- The existing `AGENTS.md` contains older Poke/MCP architecture notes. It is historical context, not the current prioritized product plan; this handoff file supersedes it for Wardrobe Studio work.
