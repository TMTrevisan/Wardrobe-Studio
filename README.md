# Wardrobe Studio

Wardrobe Studio turns ordinary outfit photos into a polished digital closet. It can import from a phone, a local photo folder, or Google Photos; identify every visible garment; let the owner approve the results; and reconstruct source-grounded ecommerce-style catalog images.

The project is an additive evolution of Antigravity Threads. Existing garments, wear history, and saved outfits remain usable.

## MCP Architecture & Live Servers

Model Context Protocol (MCP) is a primary interface for Wardrobe Studio, enabling bidirectional integrations with Poke's native assistant and other agentic clients.

### 1. Standalone MCP Server (`mcp-server/` in this repo)
- **Deployment**: Docker service deployed on Render at [`https://antigravity-threads.onrender.com`](https://antigravity-threads.onrender.com). Redeploys automatically from this repository's `main` branch (Render, not Vercel).
- **Transports**: SSE transport at `/sse` + `/message`; REST endpoints at `GET /tools` and `POST /tools/:toolName`.
- **Authentication**: `Authorization: Bearer <redacted>` (validated against `MCP_SECRET`, `POKE_API_KEY` accepted as fallback; fails closed at startup if unset).
- **Tools (9)**: `list_wardrobe`, `get_styling_recommendations`, `add_wardrobe_item`, `delete_wardrobe_item`, `suggest_outfit`, `get_garment`, `search_wardrobe`, `log_wear`, `wardrobe_stats`.

### 2. Next.js MCP Route (`src/app/api/mcp/route.ts` in this repo)
- **Deployment**: Served by Vercel project `wardrobe-studio` at [`https://wardrobe-studio-mu.vercel.app/api/mcp`](https://wardrobe-studio-mu.vercel.app/api/mcp). Auto-deploys from this repository's `main` branch.
- **Transport**: JSON-RPC 2.0 (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`).
- **Authentication**: `Authorization: Bearer <redacted>` (constant-time verification against `MCP_AUTH_TOKEN`).
- **Tools (10)**: `fetch_minified_wardrobe`, `add_garment_to_inventory`, `generate_outfit_visual`, `list_garments`, `delete_garment`, `suggest_outfit`, `get_garment`, `search_wardrobe`, `log_wear`, `wardrobe_stats`.
- **Client Integration**: Used directly by Poke's assistant (maintains 100% backward compatibility for `fetch_minified_wardrobe` and `add_garment_to_inventory`).

### 3. Sibling Reference: Wardrobe-Studio-v2 Route
- **Deployment**: `src/app/api/mcp/route.ts` in the `Wardrobe-Studio-v2` repo, served by Vercel project `wardrobe-studio-v2` at `https://wardrobe-studio-v2.vercel.app/api/mcp`.
- **Transport**: JSON-RPC 2.0.
- **Authentication**: `Authorization: Bearer <redacted>` bound to `MCP_V2_AUTH_TOKEN` and scoped to `MCP_V2_USER_ID`.
- **Tools (2)**: `fetch_minified_wardrobe`, `get_styling_recommendations`.
- **Key Divergences**:
  - *Token Variable*: `MCP_AUTH_TOKEN` (this repo's Next.js route) vs `MCP_SECRET` (this repo's standalone server) vs `MCP_V2_AUTH_TOKEN` (v2).
  - *User Scoping*: v2 binds queries to `user_id` via service-role key, while this repo's route queries via the Supabase client without user scoping.
  - *Tool Sets*: v2 offers only 2 tools, whereas this repo exposes 10 tools.

## AI stack

- **Gemini** scans batches of photos, detects the person and visible garment layers, returns normalized bounding boxes, and suggests structured metadata.
- **GPT Image 2** reconstructs an approved crop into a clean catalog photograph and later renders complete outfits on the owner.
- **Sharp** removes an automatically selected chroma background deterministically and records simple transparency QA.

This split keeps high-volume scanning fast while reserving the image model for the part that creates the product magic.

## Project handoff

The current architecture, deployed-state checklist, recent decisions, known issues, and next implementation milestones live in [docs/AGENT_HANDOFF.md](docs/AGENT_HANDOFF.md). Start there when picking up the project in a new agent session.

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
OPENAI_IMAGE_QUALITY=low
OPENAI_CATALOG_IMAGE_SIZE=816x816
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
