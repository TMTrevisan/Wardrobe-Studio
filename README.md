# Wardrobe Studio

Wardrobe Studio turns ordinary outfit photos into a polished digital closet. It can import from a phone, a local photo folder, or Google Photos; identify every visible garment; let the owner approve the results; and reconstruct source-grounded ecommerce-style catalog images.

The project is an additive evolution of Antigravity Threads. Existing garments, wear history, and saved outfits remain usable.

## AI stack

- **Gemini** scans batches of photos, detects the person and visible garment layers, returns normalized bounding boxes, and suggests structured metadata.
- **GPT Image 2** reconstructs an approved crop into a clean catalog photograph and later renders complete outfits on the owner.
- **Sharp** removes an automatically selected chroma background deterministically and records simple transparency QA.

This split keeps high-volume scanning fast while reserving the image model for the part that creates the product magic.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Without Supabase environment variables the home page intentionally opens in a populated preview mode, so the interface can be reviewed immediately.

To enable the complete flow, fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
```

Then apply [`supabase/migrations/20260715000000_wardrobe_studio_pipeline.sql`](supabase/migrations/20260715000000_wardrobe_studio_pipeline.sql) to the existing Supabase project. It adds private source/catalog buckets, import provenance, detections, generated assets, processing jobs, tags, person references, outfit items/renders, indexes, and user-owned RLS policies.

> Do not expose a Supabase service-role key in the browser. API routes use the signed-in user's bearer token so database and Storage RLS remain active.

## Google Photos / Pixel setup

1. In Google Cloud, enable **Photos Picker API**.
2. Create an OAuth 2.0 **Web application** client.
3. Add `http://localhost:3000` and the deployed site as authorized JavaScript origins.
4. Put the client ID in `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

The app uses the post-2025 Google Photos Picker flow. The user explicitly chooses photos; Wardrobe Studio does not request broad, permanent camera-roll access.

## Product flow

1. Choose outfit photos from the Pixel, Google Photos, or a folder.
2. Gemini identifies each visible top, layer, bottom, shoe, and accessory.
3. Approve only items actually owned; the server creates padded source crops.
4. Open a garment and generate a polished catalog image.
5. Curate color, pattern, formality, and descriptive tags in the garment drawer.
6. Build outfits from the approved catalog and render selected looks on the owner.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The Supabase CLI currently has no `darwin-x64` binary compatible with the Node 25 environment used to create this folder, so the new migration has not been applied to a live database automatically.
