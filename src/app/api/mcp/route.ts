import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { assertPublicHttpsUrl } from '@/lib/url-safety';
import { GoogleGenAI } from '@google/genai';
import crypto from 'node:crypto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Expose tools manifest
const TOOLS = [
  {
    name: 'fetch_minified_wardrobe',
    description: 'Retrieve all active garments in the closet in an ultra-efficient compressed plain text CSV-like format to minimize token costs.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'add_garment_to_inventory',
    description: 'Add a newly analyzed garment directly to the wardrobe database.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Tailoring'] },
        sub_category: { type: 'string' },
        brand: { type: 'string' },
        color_family: { type: 'string' },
        hex_code: { type: 'string' },
        tonal_value: { type: 'string', enum: ['Light', 'Medium', 'Dark'] },
        fabric_type: { type: 'string' },
        fit_block: { type: 'string' },
        image_url: { type: 'string', description: 'Public URL of the garment photo' },
      },
      required: ['category', 'sub_category', 'color_family', 'tonal_value', 'fabric_type', 'fit_block', 'image_url'],
    },
  },
  {
    name: 'generate_outfit_visual',
    description: 'Generate a photorealistic editorial lookbook image of the recommended clothing combinations.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Details of the garments e.g. olive long-sleeve linen shirt tucked into cream cotton trousers and brown loafers.' },
      },
      required: ['description'],
    },
  },
  {
    name: 'list_garments',
    description: 'Query all garments optionally filtered by category with pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional. Valid options: Tops, Bottoms, Outerwear, Footwear, Tailoring' },
        limit: { type: 'number', description: 'Optional limit (default 20, max 100).' },
        offset: { type: 'number', description: 'Optional offset (default 0).' },
      },
    },
  },
  {
    name: 'delete_garment',
    description: 'Permanently remove a garment from inventory using its UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The unique UUID of the garment to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'suggest_outfit',
    description: 'Compose outfit recommendations tailored to weather, occasion, and vibe using wardrobe styling rules and AI curation.',
    inputSchema: {
      type: 'object',
      properties: {
        weather: { type: 'string', description: 'Current weather context (e.g. "Chilly 48°F with rain", "75°F sunny").' },
        occasion: { type: 'string', description: 'Event or context (e.g. "casual coffee meeting", "formal dinner").' },
        vibe: { type: 'string', description: 'Optional styling aesthetic goal (e.g. "minimalist", "bold", "monochrome").' },
      },
      required: ['weather', 'occasion'],
    },
  },
  {
    name: 'get_garment',
    description: 'Retrieve full details for a single garment by its UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The UUID of the garment to retrieve.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'search_wardrobe',
    description: 'Search active garments matching category, color, or fabric filters.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter items by category (Tops, Bottoms, Outerwear, Footwear, Tailoring).' },
        color_family: { type: 'string', description: 'Filter items by color family (e.g. Black, Navy, Olive, Beige).' },
        fabric_type: { type: 'string', description: 'Filter items by fabric type (e.g. Linen, Cotton, Wool, Denim).' },
        limit: { type: 'number', description: 'Maximum number of items to return (default 20, max 100).' },
      },
    },
  },
  {
    name: 'log_wear',
    description: 'Log that one or more garments were worn at a given date/time.',
    inputSchema: {
      type: 'object',
      properties: {
        garment_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of garment UUIDs that were worn.',
        },
        worn_at: {
          type: 'string',
          description: 'Optional ISO timestamp when the garments were worn. Defaults to now.',
        },
      },
      required: ['garment_ids'],
    },
  },
  {
    name: 'wardrobe_stats',
    description: 'Retrieve high-level wardrobe statistics: counts by category/status, wears in last 30 days, most worn items, and cost-per-wear.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export async function POST(request: Request) {
  try {
    // 1. Bearer Token Security Authentication Check
    const authHeader = request.headers.get('authorization');
    const systemToken = process.env.MCP_AUTH_TOKEN || '';

    if (!systemToken) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Server configuration error: MCP_AUTH_TOKEN is missing.' }, id: null }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized access.' }, id: null }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.substring(7).trim();
    const tokenBuf = Buffer.from(token);
    const systemTokenBuf = Buffer.from(systemToken);
    if (tokenBuf.length !== systemTokenBuf.length || !crypto.timingSafeEqual(tokenBuf, systemTokenBuf)) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized access.' }, id: null }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { method, params, id } = body;

    // 2. Handle JSON-RPC 2.0 Handshakes
    if (method === 'initialize') {
      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'wardrobe-studio-mcp', version: '2.0.0' },
        },
        id,
      });
    }

    if (method === 'notifications/initialized') {
      return new Response(null, { status: 204 });
    }

    if (method === 'tools/list') {
      return NextResponse.json({
        jsonrpc: '2.0',
        result: { tools: TOOLS },
        id,
      });
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};

      switch (name) {
        case 'fetch_minified_wardrobe': {
          const { data: garments, error } = await supabase
            .from('garments')
            .select('id, category, sub_category, brand, color_family, tonal_value, fabric_type, fit_block, pattern, formality, season')
            .eq('status', 'Active')
            .limit(300);

          if (error) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32002, message: error.message },
              id,
            });
          }

          // Minified Data Serialization Protocol
          // ID|Category|Sub-Category|Color|Tone|Fabric|Fit
          const serialized = (garments || [])
            .map((item: any) => `${item.id}|${item.category}|${item.sub_category}|${item.color_family}|${item.tonal_value}|${item.fabric_type}|${item.fit_block}`)
            .join('\n');

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: serialized || 'Your closet is currently empty. Add items first!',
                },
              ],
            },
            id,
          });
        }

        case 'add_garment_to_inventory': {
          const { category, sub_category, brand, color_family, hex_code, tonal_value, fabric_type, fit_block, image_url } = args || {};

          if (image_url) {
            try {
              await assertPublicHttpsUrl(image_url);
            } catch (urlErr: any) {
              return NextResponse.json({
                jsonrpc: '2.0',
                error: { code: -32602, message: `Invalid image_url: ${urlErr.message}` },
                id,
              });
            }
          }

          // Insert core garment
          const { data: garment, error: garmentError } = await supabase
            .from('garments')
            .insert([
              {
                category,
                sub_category,
                brand: brand || null,
                color_family,
                hex_code: hex_code || null,
                tonal_value,
                fabric_type,
                fit_block,
                status: 'Active',
              },
            ])
            .select()
            .single();

          if (garmentError || !garment) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32003, message: garmentError?.message || 'Garment insert error' },
              id,
            });
          }

          // Register profile image
          const { error: imageError } = await supabase
            .from('garment_images')
            .insert([
              {
                garment_id: garment.id,
                storage_path: image_url,
                is_primary_profile: true,
                asset_type: 'profile',
              },
            ]);

          if (imageError) {
            console.error('MCP Inbound Image insertion failed:', imageError.message);
          }

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: `Success! Added a ${tonal_value.toLowerCase()} ${color_family} ${sub_category} (${fabric_type}, ${fit_block} fit) to your closet.`,
                },
              ],
            },
            id,
          });
        }

        case 'generate_outfit_visual': {
          const { description } = args || {};

          // Construct high-end Lookbook prompt structure
          const lookbookPrompt = `A high-end editorial men's fashion lookbook photograph. A realistic athletic model is wearing a ${description}. Clean studio lighting, neutral minimalist background, high fashion styling asset.`;

          // Generate using Pollinations.ai (Free, instant high-quality SDXL/Flux generation endpoint)
          const generatedUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(lookbookPrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: `Here is the rendering for the recommended outfit combination:\n${generatedUrl}`,
                },
              ],
            },
            id,
          });
        }

        case 'list_garments': {
          const { category } = args || {};
          const rawLimit = Number(args?.limit);
          const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 20, 1), 100);
          const rawOffset = Number(args?.offset);
          const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;

          if (category) {
            const validCategories = ['Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Tailoring'];
            if (!validCategories.includes(category)) {
              return NextResponse.json({
                jsonrpc: '2.0',
                error: { 
                  code: -32602, 
                  message: `Invalid Category filter. Must be one of: ${validCategories.join(', ')}` 
                },
                id,
              });
            }
          }

          let query = supabase
            .from('garments')
            .select('id, category, sub_category, brand, color_family, hex_code, tonal_value, fabric_type, fit_block, status, price, created_at')
            .eq('status', 'Active');

          if (category) {
            query = query.eq('category', category);
          }

          query = query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

          const { data: garments, error } = await query;
          if (error) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32004, message: error.message },
              id,
            });
          }

          const serialized = (garments || [])
            .map((item: any) => `${item.id}|${item.category}|${item.sub_category}|${item.color_family}|${item.fabric_type}|${item.brand || 'Generic'}`)
            .join('\n');

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [{
                type: 'text',
                text: serialized || 'No items found matching the filters.',
              }],
            },
            id,
          });
        }

        case 'delete_garment': {
          const { id: itemId } = args || {};

          if (!itemId || !UUID_REGEX.test(itemId)) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { 
                code: -32602, 
                message: 'Invalid UUID format provided for deletion. Please check the garment ID and try again.' 
              },
              id,
            });
          }

          // Fetch to check existence
          const { data: garmentCheck } = await supabase.from('garments').select('id').eq('id', itemId).single();
          if (!garmentCheck) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { 
                code: -32005, 
                message: 'Garment not found in closet.' 
              },
              id,
            });
          }

          // Delete image relationships
          await supabase.from('garment_images').delete().eq('garment_id', itemId);

          const { error: deleteError } = await supabase
            .from('garments')
            .delete()
            .eq('id', itemId);

          if (deleteError) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32006, message: deleteError.message },
              id,
            });
          }

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [{
                type: 'text',
                text: `Success! Garment ID ${itemId} has been permanently deleted from your inventory.`,
              }],
            },
            id,
          });
        }

        case 'suggest_outfit': {
          const { weather, occasion, vibe } = args || {};

          if (!weather || typeof weather !== 'string' || !occasion || typeof occasion !== 'string') {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: {
                code: -32602,
                message: 'Missing required parameters: weather and occasion are required strings.',
              },
              id,
            });
          }

          const geminiApiKey = process.env.GEMINI_API_KEY;
          if (!geminiApiKey) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32003, message: 'styling not configured' },
              id,
            });
          }

          const { data: garments, error: garmentError } = await supabase
            .from('garments')
            .select('id, category, sub_category, brand, color_family, hex_code, tonal_value, fabric_type, fit_block, pattern, formality, season')
            .eq('status', 'Active')
            .limit(150);

          if (garmentError) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32002, message: garmentError.message },
              id,
            });
          }

          if (!garments || garments.length === 0) {
            const emptyPayload = {
              outfits: [],
              gap: 'Wardrobe is empty. Add active garments to get outfit suggestions.',
              reason: 'No active garments found in closet.',
            };
            return NextResponse.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: JSON.stringify(emptyPayload, null, 2) }],
                structuredContent: emptyPayload,
                ...emptyPayload,
              },
              id,
            });
          }

          const closetString = garments
            .map((g: any) => `${g.id}|${g.category}|${g.sub_category}|${g.brand || ''}|${g.color_family}|${g.tonal_value || ''}|${g.fabric_type || ''}|${g.fit_block || ''}|${g.pattern || ''}|${g.formality || ''}`)
            .join('\n');

          const prompt = `You are an expert personal fashion stylist. Recommend 2 distinct outfit options tailored for:
- Weather: ${weather}
- Occasion: ${occasion}
${vibe ? `- Vibe: ${vibe}\n` : ''}
Available Wardrobe Items (Format: id|category|sub_category|brand|color|tone|fabric|fit|pattern|formality):
${closetString}

Styling Guidance:
- Contrast & Harmony: Balance tones (e.g. light top with dark bottoms) and textures.
- Silhouette & Formality: Match formality to occasion, and fabric/layers to weather.
- Structure: Outfits must include a top (or tailoring piece) and a bottom, plus footwear if available, and outerwear if weather requires.
- Garment IDs: Refer to garments ONLY by their exact UUID from the closet list above.

Return a strict JSON object with this format:
{
  "outfits": [
    {
      "name": "Outfit 1 title",
      "garment_ids": ["<garment_id>", "<garment_id>"],
      "reason": "One-sentence reason for choosing this outfit."
    },
    {
      "name": "Outfit 2 title",
      "garment_ids": ["<garment_id>", "<garment_id>"],
      "reason": "One-sentence reason for choosing this outfit."
    }
  ],
  "gap": "One wardrobe gap (staple item or color missing to complete this style)."
}`;

          try {
            const ai = new GoogleGenAI({ apiKey: geminiApiKey });
            const modelName = process.env.GEMINI_VISION_MODEL || 'gemini-3.1-flash-lite';
            const response = await ai.models.generateContent({
              model: modelName,
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
              },
            });

            const rawText = response.text || '';
            let parsed: any = null;
            try {
              parsed = JSON.parse(rawText);
            } catch {
              // parsing failed
            }

            if (parsed && typeof parsed === 'object') {
              // Sanity-check picks against closet items
              const validIds = new Set(garments.map((g: any) => g.id));
              if (Array.isArray(parsed.outfits)) {
                parsed.outfits = parsed.outfits.map((o: any) => ({
                  ...o,
                  garment_ids: Array.isArray(o.garment_ids)
                    ? o.garment_ids.filter((gid: string) => validIds.has(gid))
                    : [],
                }));
              }

              return NextResponse.json({
                jsonrpc: '2.0',
                result: {
                  content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
                  structuredContent: parsed,
                  ...parsed,
                },
                id,
              });
            }

            // Fall back to raw text in content if parsing fails
            return NextResponse.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: rawText }],
              },
              id,
            });
          } catch (aiErr: any) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32003, message: `Styling generation failed: ${aiErr.message || 'Unknown error'}` },
              id,
            });
          }
        }

        case 'get_garment': {
          const { id: itemId } = args || {};

          if (!itemId || typeof itemId !== 'string' || !UUID_REGEX.test(itemId)) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: {
                code: -32602,
                message: 'Invalid UUID format provided. Please check the garment ID and try again.',
              },
              id,
            });
          }

          const { data: garment, error } = await supabase
            .from('garments')
            .select('id, user_id, category, sub_category, brand, color_family, hex_code, tonal_value, fabric_type, fit_block, status, ai_extracted_json, notes, price, pattern, season, formality, created_at, updated_at')
            .eq('id', itemId)
            .single();

          if (error || !garment) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32005, message: error?.message || 'Garment not found in closet.' },
              id,
            });
          }

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify(garment, null, 2),
              }],
              structuredContent: garment,
              garment,
            },
            id,
          });
        }

        case 'search_wardrobe': {
          const { category, color_family, fabric_type } = args || {};
          const rawLimit = Number(args?.limit);
          const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 20, 1), 100);

          let query = supabase
            .from('garments')
            .select('id, user_id, category, sub_category, brand, color_family, hex_code, tonal_value, fabric_type, fit_block, status, notes, price, pattern, season, formality, created_at')
            .eq('status', 'Active');

          if (category && category !== 'All') {
            query = query.eq('category', category);
          }
          if (color_family) {
            query = query.ilike('color_family', `%${color_family}%`);
          }
          if (fabric_type) {
            query = query.ilike('fabric_type', `%${fabric_type}%`);
          }

          const { data, error } = await query.limit(limit);
          if (error) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32002, message: error.message },
              id,
            });
          }

          const garments = data || [];
          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify(garments, null, 2),
              }],
              structuredContent: garments,
              garments,
            },
            id,
          });
        }

        case 'log_wear': {
          const { garment_ids, worn_at } = args || {};

          if (!Array.isArray(garment_ids) || garment_ids.length === 0) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: {
                code: -32602,
                message: 'Missing or invalid "garment_ids": must be a non-empty array of UUIDs.',
              },
              id,
            });
          }

          for (const gid of garment_ids) {
            if (typeof gid !== 'string' || !UUID_REGEX.test(gid)) {
              return NextResponse.json({
                jsonrpc: '2.0',
                error: {
                  code: -32602,
                  message: `Invalid UUID in garment_ids: "${gid}".`,
                },
                id,
              });
            }
          }

          let wornAtIso = new Date().toISOString();
          if (worn_at) {
            const parsedDate = new Date(worn_at);
            if (isNaN(parsedDate.getTime())) {
              return NextResponse.json({
                jsonrpc: '2.0',
                error: {
                  code: -32602,
                  message: `Invalid "worn_at" date format: "${worn_at}". Must be valid ISO date.`,
                },
                id,
              });
            }
            wornAtIso = parsedDate.toISOString();
          }

          const rowsToInsert = garment_ids.map((gid: string) => ({
            garment_id: gid,
            worn_at: wornAtIso,
          }));

          const { data: insertedData, error: insertError } = await supabase
            .from('wear_logs')
            .insert(rowsToInsert)
            .select('id');

          if (insertError) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32007, message: insertError.message },
              id,
            });
          }

          const logged = insertedData ? insertedData.length : garment_ids.length;
          const resPayload = { logged };

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify(resPayload, null, 2),
              }],
              structuredContent: resPayload,
              ...resPayload,
            },
            id,
          });
        }

        case 'wardrobe_stats': {
          const [{ data: garmentsData, error: gError }, { data: wearLogsData, error: wError }] = await Promise.all([
            supabase.from('garments').select('id, category, sub_category, brand, status, price'),
            supabase.from('wear_logs').select('id, garment_id, worn_at'),
          ]);

          if (gError) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32008, message: gError.message },
              id,
            });
          }
          if (wError) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32008, message: wError.message },
              id,
            });
          }

          const garments = garmentsData || [];
          const wearLogs = wearLogsData || [];

          const by_category: Record<string, number> = {};
          const by_status: Record<string, number> = {};
          for (const g of garments) {
            const cat = g.category || 'Unknown';
            const stat = g.status || 'Unknown';
            by_category[cat] = (by_category[cat] || 0) + 1;
            by_status[stat] = (by_status[stat] || 0) + 1;
          }

          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          let wears_last_30d = 0;
          const wearCountByGarment: Record<string, number> = {};

          for (const log of wearLogs) {
            if (log.worn_at && new Date(log.worn_at) >= thirtyDaysAgo) {
              wears_last_30d++;
            }
            if (log.garment_id) {
              wearCountByGarment[log.garment_id] = (wearCountByGarment[log.garment_id] || 0) + 1;
            }
          }

          const garmentMap = new Map(garments.map((g: any) => [g.id, g]));
          const sortedWearEntries = Object.entries(wearCountByGarment).sort(([, a], [, b]) => b - a);

          const most_worn = sortedWearEntries.slice(0, 10).map(([id, wearCount]) => {
            const g = garmentMap.get(id);
            return {
              id,
              sub_category: g?.sub_category || 'Unknown',
              brand: g?.brand || null,
              wears: wearCount,
            };
          });

          const pricedItems = garments.filter(
            (g: any) => g.price !== null && g.price !== undefined && Number(g.price) > 0
          );

          const cost_per_wear = pricedItems
            .map((g: any) => {
              const price = Number(g.price);
              const wears = wearCountByGarment[g.id] || 0;
              const cpw = wears > 0 ? Number((price / wears).toFixed(2)) : null;
              return {
                id: g.id,
                sub_category: g.sub_category || 'Item',
                price,
                wears,
                cpw,
              };
            })
            .sort((a, b) => b.wears - a.wears)
            .slice(0, 10);

          const stats = {
            by_category,
            by_status,
            wears_last_30d,
            most_worn,
            cost_per_wear,
          };

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify(stats, null, 2),
              }],
              structuredContent: stats,
              ...stats,
            },
            id,
          });
        }

        default:
          return NextResponse.json({
            jsonrpc: '2.0',
            error: { code: -32601, message: `Method not found: ${name}` },
            id,
          });
      }
    }

    return NextResponse.json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request' },
      id,
    });
  } catch (error: any) {
    console.error('MCP route handler error:', error);
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: error.message || 'Internal error' }, id: null }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
