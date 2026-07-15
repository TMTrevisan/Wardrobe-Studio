<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# 🤖 Poke + MCP Bidirectional Architecture

This guide outlines the system design, knowledge paradigms, integration rules, and prompt engineering blueprints for building bidirectional interfaces between **Poke API** and the **Next.js/Supabase Wardrobe stack**.

* **Poke + MCP Bidirectional Architecture Confidence:** High (Using MCP manifests).
* **On-Demand Photorealistic Outfit Generation Confidence:** Moderate (Constrained by rendering latencies and compute costs of current diffusion models).

---

## 🔄 The Paradigm Shift: Poke as Runtime, Our Stack as Tool

Legacy workflows push data to Poke via webhooks. Under the **Model Context Protocol (MCP)**, the model flips:
* **Poke's native LLM assistant acts as the primary user interface.**
* **The Vercel/Supabase backend acts as an MCP Server** exposing specialized tools.

```
[Phone / Camera] 🔀 [Poke Assistant App] 🔀 [MCP Gateway Protocol] 🔀 [Next.js MCP Server Route] 🔀 [Supabase Database]
```

### 1. Ingestion Sequence via Text/Camera
1. **Multi-Modal Evaluation**: Poke's model analyzes the uploaded photo (wide layouts or tag close-ups).
2. **Tool Discovery**: Poke scans the MCP manifest at `/api/mcp` and locates the `add_garment_to_inventory` tool.
3. **Structured Extraction**: Poke extracts metadata properties (Category, Sub-Category, Color, Fabric, Fit) and executes a JSON-RPC tool call: `add_garment_to_inventory(metadata)`.
4. **Database Commit**: The server inserts the data securely to Supabase. Poke responds via text: *"Added a charcoal wool tailored trousers to your closet."*

### 2. Styling Sequence via Text
1. **Context Integration**: User asks for styling recommendations. Poke triggers the **Pirate Weather API hook** to check conditions.
2. **Wardrobe Retrieval**: Poke executes `fetch_minified_wardrobe` via MCP. The server returns the compressed text string format: `ID|Category|Sub-Category|Color|Fabric|Fit`.
3. **Synthesis**: Poke applies styling rules (Contrast, Silhouette Harmony, Textural Contrast) on your wardrobe.
4. **Output Delivery**: Responds with actionable matching details.

---

## 👟 System Grounding: Footwear Curation

Ensure that footwear is treated as a core structural element matching the trouser choice:
* Category Enums: `Footwear` is enforced.
* Textures (e.g. suede, calfskin, canvas) are checked against trousers to prevent clashing.

---

## 🎨 Visualization Prompt Blueprint
When the user appends *"...and show me what it looks like"*, the stylist compiles the IDs, outputs a text prompt to a diffusion model (Flux/SDXL), uploads the output back to Supabase, and returns the image:

```text
"A high-end editorial men's fashion lookbook photograph. A realistic athletic model is wearing a [Garment 1 Description] cleanly tucked into [Garment 2 Description], paired with [Footwear Description]. Clean studio lighting, neutral minimalist background, high fashion styling asset."
```

---

## 📡 Poke V2 API Integration Guide

Send automated event alerts from your pipeline to Poke using the V2 Endpoint.

* **Endpoint**: `POST https://poke.com/api/v1/inbound/api-message`
* **Authentication**: `Authorization: Bearer <V2_API_KEY>` (Create keys in [Kitchen](https://poke.com/kitchen)).
* **Content-Type**: `application/json`

### Body Example
```json
{
  "message": "Deploy failed on main. Create incident ticket and notify on-call."
}
```

### Curl Example
```bash
curl 'https://poke.com/api/v1/inbound/api-message' \
  -H "Authorization: Bearer $POKE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Generate outfit combination for 75-degree sunny weather"}'
```
