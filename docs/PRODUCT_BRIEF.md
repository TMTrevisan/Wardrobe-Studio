# Wardrobe Studio — Product Brief and Recovery Roadmap

Last updated: 2026-07-15

## Product promise

Wardrobe Studio is a personal wardrobe system, not merely a catalog-image demo. A user should be able to collect a complete closet from existing photos and deliberate garment captures; preserve every useful source image and piece of metadata; generate polished catalog cutouts economically; plan outfits; and understand the cost of AI work before it happens.

The Studio visual direction (quiet editorial grid, clean garment cutouts, desktop/mobile use) is correct. It must be built on top of the established wardrobe product rather than replacing its mature editing, image, bulk-management, pricing, and ingestion capabilities.

## Non-negotiables

1. **Never discard legacy user data.** Existing garments, `garment_images`, brand, fabric, fit, notes, price, wear history, and outfit links remain first-class.
2. **A garment has multiple source images.** Front/back/detail/tag/fabric/size/brand shots are evidence for one garment, not duplicate garments.
3. **AI proposals are editable and traceable.** AI may suggest category, colors, tags, and a catalog image; a user can change them and see the underlying source assets.
4. **No surprise generation spend.** All paid image batches show count, model/quality, estimate, and budget impact before starting.
5. **Mobile is a primary capture surface.** Phone uploads, Pixel/Google Photos selection, and camera-roll workflows must be practical, not desktop-only workarounds.

## What already exists and must be retained

The original application already contains implementation patterns/components for:

- multi-image garment records: `garment_images` with profile and detail shots;
- image add/delete/primary selection and image-search flows;
- manual fields: brand, category, sub-category, color, hex, tonal value, fabric, fit, price, status, notes, and purchase year;
- bulk selection, bulk delete, reclassification, status changes, CSV export, image-orphan repair, and matrix editing;
- outfit records, wear logs, measurements, telemetry/billing ledger, weather/stylist functions, and chat;
- a legacy batch reclassification path that reads all garment images.

The current Studio shell replaced rather than integrated many of these. That is a regression to reverse.

## Current production facts (not assumptions)

- Legacy garment records still contain the missing fields; they were hidden by the new drawer, not erased.
- Many legacy garments retain 2–5 `garment_images` and have no Studio `source_crop` asset.
- The Studio currently marks only `source_crop` assets as eligible for catalog generation. Therefore legacy items such as the moccasins are incorrectly denied the Generate action even though they have usable primary images.
- Current Studio color suggestion swatches are static UI values, not image-derived values. They must be removed/replaced.
- New image pipeline has been verified end to end in production: source crop → GPT Image → chroma removal → ready 816×816 cutout.
- **Data inventory verified 2026-07-15:** 119 garments, 230 legacy `garment_images`, 6 original import photos, 5 Studio source crops, 9 generated chroma images, and 9 final catalog cutouts. These assets remain in Supabase; the minimalist Studio drawer shows only one hero image and therefore hides most of this evidence.
- A generated catalog image does not replace or delete its source image. It creates a `processing_jobs` record plus a `catalog_chroma` and `catalog_cutout` asset. Failed jobs also remain recorded for diagnosis.

## Immediate recovery backlog (P0)

1. **Legacy compatibility**
   - Any garment with a primary legacy image is eligible for catalog generation.
   - Catalog generation reads the selected legacy image from `wardrobe-images` and persists a Studio catalog asset without overwriting source images or old metadata.
   - Studio drawer shows all legacy images with primary selection, add, delete, and image role/detail visibility.
2. **Restore complete garment editor**
   - Show and persist all existing fields: brand, sub-category, color, tonal value, fabric, fit, pattern, season, formality, size, price, purchase year, status, notes, and source images.
   - Save should close the drawer (with an unobtrusive success state in the grid) unless the user explicitly chooses “Save and keep editing.”
3. **Bulk workbench**
   - Selection mode in the Studio grid with select-all filtered items.
   - Bulk: generate/retry catalog, delete (confirmed), archive/status, reclassify, and color/tag review.
   - Never auto-run “next 20” paid generations without an explicit selected set and a cost confirmation.
4. **Correct color model/UI**
   - Remove hard-coded swatches.
   - Store one manually editable primary color plus optional secondary/accent colors with role/coverage.
   - AI extraction must use the garment crop/segmentation, not the whole outfit photo, so skin, background, and adjacent clothes cannot become a shirt's primary color.
5. **Outfit flow**
   - Outfits opens a dedicated composition/selection state, not the generic grid followed by the garment editor.
   - Clicking a garment in outfit selection toggles inclusion; editing is an explicit secondary action.

## Next implementation sequence (authoritative)

### Release A — Asset gallery and generation provenance (do first)

Goal: make existing data visible and controllable before creating more.

1. Extend `GET /api/items` to sign and return every `garment_images` and `garment_assets` row, including asset kind, timestamps, generation prompt/model/quality, primary status, and safe source path metadata.
2. Replace the drawer's single hero image with a horizontally scrollable, versioned gallery:
   - **Originals**: existing front/back/detail/tag/fabric/size/brand photos;
   - **Source crop**: the evidence image used for a Studio generation;
   - **Generated background**: chroma image, useful for diagnosing masking;
   - **Catalog cutouts**: every retained output, with a primary badge.
3. Add explicit controls: choose primary display image, choose catalog-generation source, add image, label image role, delete a non-primary/non-last source with confirmation, and restore a prior catalog version.
4. In the generation panel, show a compact progress timeline: `Source selected → normalized → GPT Image → background removed → QA → saved`. On failure show the exact failed stage and keep all prior assets available.
5. Regenerate always creates a new version; never erase a previous successful image. New generation must show source image, model/quality/size, estimated cost, and confirmation.

### Release B — Metadata repair and review workbench

Goal: repair the existing closet rather than letting wrong suggestions accumulate.

1. Add a per-garment **Re-analyze metadata** action that uses the selected garment crop or deliberate multi-photo evidence, not a full outfit photo.
2. Add a bulk **Data review** queue: primary color, optional secondary/accent/print colors, brand, subcategory, material, tags, and confidence/evidence.
3. Store color roles separately (`primary`, `secondary`, `accent`, coverage, source/evidence) rather than static palette suggestions. The user accepts changes individually or in a selected batch; no silent overwrites.
4. Standardize display names as `Brand + Color + Subcategory`; new intake already starts using this only when a visible brand can be supported. Existing records require review, not automatic rewrite.

### Release C — Outfit Composer (not another grid)

Goal: reproduce and improve the original app's useful styling flow.

1. **Brief:** user enters occasion, dress code, optional mood, location/temperature, and optionally turns on local weather.
2. **Capsule:** system proposes a compact eligible set with category coverage and explains why each piece is included.
3. **Options:** generate several outfit cards, with alternatives and filters; clicking a garment toggles it in the composer, while editing is a distinct action.
4. **Persistence:** save outfits, log wear, surface weather/occasion rationale, and later render selected looks on the user's approved person reference.

### Release D — Mobile-first multi-photo ingestion and wallet

1. Direct-to-Supabase authenticated uploads for original-resolution phone/Google Photos assets; client compression is a temporary Vercel-body-limit mitigation.
2. A single garment capture can contain front/back/detail/tag/fabric/size/brand shots, labelled with image roles and grouped before metadata extraction.
3. Complete wallet: batch estimate, daily cap, ledger/history, source/model/quality, and explicit user approval before paid work.

## Core data model to implement (P1)

Keep the existing tables; add relationships rather than replacing them.

```text
garments
 ├── garment_images          legacy/manual source photos (profile/detail)
 ├── garment_assets          Studio crops, catalog cutouts, renders
 ├── garment_tags            user/AI tags
 ├── garment_color_roles     NEW: primary / secondary / accent, name, hex, coverage, source
 ├── garment_photo_groups    NEW: a capture session/group for front/tag/fabric/size shots
 └── evidence links          each AI field can point to one or more source images/detections
```

`garment_photo_groups` should preserve photo purpose (`front`, `back`, `detail`, `tag`, `fabric`, `size`, `brand`, `other`) and let the user choose the preferred catalog source. It should not remove `garment_images` during migration.

## Ingestion design (P1)

### A. Existing outfit/camera-roll photo

1. User selects one or more photos locally or with Google Photos Picker.
2. They may mark “photos with me” and choose the person when several people appear.
3. Gemini detects garment candidates in each image; UI groups likely same garments across selected photos.
4. User approves/rejects/merges candidates.
5. The system creates a garment only after approval and retains all source evidence.

### B. Deliberate multi-photo garment capture

1. User creates a garment capture and adds front/back/detail/tag/fabric/size/brand photos.
2. The UI labels roles automatically but permits correction.
3. Gemini extracts metadata from all evidence (brand/size/tag shots have priority for those fields).
4. User picks the front/profile image for catalog reconstruction.

### Upload architecture

Large mobile camera images must upload directly to Supabase Storage through authenticated/signed upload paths or be compressed client-side before proxying. A server-proxied Vercel request was observed to reject a large image with HTTP 413.

## Catalog image policy (P1)

- Default: GPT Image low quality, 816×816, one selected source image per garment.
- Display estimated cost, daily budget remaining, and count before a batch.
- Preserve source crop, chroma intermediate, and final cutout; never replace the only prior good result.
- A regenerate creates a new version; primary selection is explicit.
- Use a separate repair/retry state for older broken assets, with no silent retry loop.

## Wallet, pricing, and spend controls (P1)

The existing `billing_and_token_ledger` and telemetry UI are the foundation. Complete the following:

- persist provider/model/quality/size, request count, estimated/actual cost, garment/import/job IDs;
- show per-batch estimate in the import and bulk-generation UI;
- enforce a server-side rolling 24-hour user cap (`DAILY_SPENDING_CAP_USD`), with clear refusal messaging;
- add a wallet/usage page with current balance/allowance, estimated next action cost, generation history, and later subscription/credits;
- keep Gemini detection and image-generation costs distinct.

## Outfit and try-on roadmap (P2)

- outfit canvas with explicit selection, category completeness checks, filters, save, and explanation;
- recommend from closet data plus weather/calendar context only with user consent;
- person profile creation from selected photos; virtual try-on/render versions linked to source garments;
- do not conflate “edit garment” click behavior with “choose for outfit.”

## Verification standard

A feature is not complete because it builds or has a unit test. For any changed workflow, verify:

1. signed-in production UI state on desktop and mobile viewport;
2. network response and persisted database rows;
3. Storage object bytes/format for any image asset;
4. the exact user path, including retry, cancellation, and legacy-data compatibility;
5. no unexpected paid generation during a test; document each intentional generation.

## Acceptance criteria for the next release

- Moccasins and other legacy garments display all stored metadata and all source images.
- A user can scroll every retained original and generated image, understand which was used for a generation, select another source, and safely remove a non-essential image.
- They can generate a catalog image from an existing primary image.
- User can select several incorrect garments and delete or reclassify them with one confirmation.
- A white shirt’s primary color is white; optional print/accent colors are separately represented.
- User can add/edit/remove detail tags and additional images.
- Save returns from the drawer to the wardrobe grid.
- Outfits begins with selection mode, not an edit drawer.
- The handoff points to this document and preserves this scope.
