import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config();

const port = process.env.PORT || 10000;

// PRIORITY 1: Fail-closed authentication check at startup
const MCP_SECRET = (process.env.MCP_SECRET || process.env.POKE_API_KEY || '').trim();

if (!MCP_SECRET) {
  console.error(
    'FATAL: MCP_SECRET (or POKE_API_KEY) environment variable is unset or empty at startup. ' +
      'Server cannot start with mutation/deletion tools without authentication. ' +
      'Please set MCP_SECRET before starting the server.'
  );
  process.exit(1);
}

// Initialize Supabase Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder';

if (supabaseUrl === 'https://placeholder.supabase.co') {
  console.warn('CRITICAL: Supabase credentials are not set in environment variables. Using placeholders.');
}
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
  },
});

// Initialize Gemini Client
const geminiApiKey = process.env.GEMINI_API_KEY || '';
const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
const GEMINI_MODEL = process.env.GEMINI_STYLIST_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// UUID validation helper
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateUuid(id: unknown, fieldName: string = 'id'): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(`Invalid ${fieldName}: must be a non-empty string.`);
  }
  const trimmed = id.trim();
  if (!UUID_REGEX.test(trimmed)) {
    throw new Error(`Invalid ${fieldName}: "${trimmed}" is not a valid UUID format.`);
  }
  return trimmed;
}

/* ─────────────────────────────────────────────────────────────────────
 * Ported Pure Styling Rules (from src/lib/styling-rules.ts)
 * ───────────────────────────────────────────────────────────────────── */

interface GarmentRecord {
  id: string;
  category: string;
  sub_category: string;
  brand: string | null;
  color_family: string;
  hex_code?: string | null;
  tonal_value?: string | null;
  fabric_type?: string | null;
  fit_block?: string | null;
  notes?: string | null;
  price?: number | null;
  status?: string;
  created_at?: string;
}

interface RuleContext {
  weather?: string;
  occasion?: string;
  vibe?: string;
}

const SCORE_CLASH = 0;
const SCORE_NEUTRAL = 1;
const SCORE_MATCH = 2;

function scorePair(a: GarmentRecord, b: GarmentRecord, ctx: RuleContext): number {
  let score = 0;
  let checks = 0;

  // 1. Same-color (monochromatic look)
  if (a.color_family && b.color_family && a.color_family.toLowerCase() === b.color_family.toLowerCase()) {
    score += SCORE_MATCH;
  } else {
    score += SCORE_NEUTRAL;
  }
  checks++;

  // 2. High contrast between tops and bottoms
  const isTopBottom =
    (a.category.toLowerCase() === 'tops' && b.category.toLowerCase() === 'bottoms') ||
    (a.category.toLowerCase() === 'bottoms' && b.category.toLowerCase() === 'tops');
  if (isTopBottom && a.tonal_value && b.tonal_value) {
    if (a.tonal_value.toLowerCase() !== b.tonal_value.toLowerCase()) {
      score += SCORE_MATCH;
    } else {
      score += SCORE_NEUTRAL;
    }
    checks++;
  }

  // 3. Breathable in heat
  if (ctx.weather) {
    const isWarm = /\b(7[0-9]|8[0-9]|9[0-9])\b/i.test(ctx.weather) || /warm|hot|sunny/i.test(ctx.weather);
    const isCold = /\b([0-3]?[0-9]|4[0-9])\b/i.test(ctx.weather) || /cold|chilly|snow|freez/i.test(ctx.weather);

    for (const item of [a, b]) {
      const isBreathable = /linen|cotton|silk/i.test(item.fabric_type || '');
      const isWarmFabric = /wool|cashmere|fleece|knitwear|heavy/i.test(item.fabric_type || '');
      if (isWarm) {
        score += isBreathable ? SCORE_MATCH : SCORE_CLASH;
        checks++;
      }
      if (isCold) {
        score += isWarmFabric ? SCORE_MATCH : SCORE_CLASH;
        checks++;
      }
    }
  }

  // 4. Tailoring for formal
  const isFormal = /corporate|formal|dinner|gala|black\s*tie|business/i.test(ctx.occasion || '');
  if (isFormal) {
    if (a.category.toLowerCase() === 'tailoring' || b.category.toLowerCase() === 'tailoring') {
      score += SCORE_MATCH;
    }
    checks++;
  }

  // 5. Footwear matches formality
  const footwear = a.category.toLowerCase() === 'footwear' ? a : b.category.toLowerCase() === 'footwear' ? b : null;
  if (footwear) {
    const isSneaker = /sneaker|runner|trainer/i.test(footwear.sub_category || '');
    if (isFormal && isSneaker) {
      score += SCORE_CLASH;
    } else if (isFormal && !isSneaker) {
      score += SCORE_MATCH;
    } else {
      score += SCORE_MATCH;
    }
    checks++;
  }

  return checks > 0 ? score / checks : 1;
}

function scoreOutfit(items: GarmentRecord[], ctx: RuleContext): number {
  if (items.length < 2) return 1;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      total += scorePair(items[i], items[j], ctx);
      pairs++;
    }
  }
  return pairs > 0 ? total / pairs : 1;
}

// Exposed Tools Manifest matching the schema
const TOOLS_MANIFEST = [
  {
    name: 'suggest_outfit',
    description:
      'Compose an outfit recommendation tailored to weather, occasion, and vibe using wardrobe styling rules and AI curation.',
    inputSchema: {
      type: 'object',
      properties: {
        weather: {
          type: 'string',
          description: 'Current weather context (e.g. "Chilly 48°F with rain", "75°F and sunny").',
        },
        occasion: {
          type: 'string',
          description: 'Event or context (e.g. "casual coffee meeting", "formal dinner", "cocktail party").',
        },
        vibe: {
          type: 'string',
          description: 'Optional styling aesthetic goal (e.g. "minimalist", "bold", "monochrome").',
        },
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
        id: {
          type: 'string',
          description: 'The UUID of the garment to retrieve.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'search_wardrobe',
    description: 'Search active garments matching category, color, fabric, or notes filters.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter items by category (Tops, Bottoms, Outerwear, Footwear, Tailoring).',
        },
        color_family: {
          type: 'string',
          description: 'Filter items by color family (e.g. Black, Navy, Olive, Beige).',
        },
        fabric_type: {
          type: 'string',
          description: 'Filter items by fabric type (e.g. Linen, Cotton, Wool, Denim).',
        },
        tags: {
          type: 'string',
          description: 'Keyword to search inside garment notes or sub_category.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to return (default 20, max 100).',
        },
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
    description:
      'Retrieve high-level wardrobe statistics: counts by category/status, total wears in the last 30 days, top 5 most worn items, and cost-per-wear.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_wardrobe',
    description: 'List garments stored in the archive with pagination and category/status filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter items by category (e.g. Tops, Bottoms, Outerwear, Footwear, Tailoring)',
        },
        status: {
          type: 'string',
          description: 'Filter items by status (e.g. Active, Donate, Sell). Defaults to "Active".',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to return (default 20, max 100).',
        },
        offset: {
          type: 'number',
          description: 'Number of items to skip for pagination (default 0).',
        },
      },
    },
  },
  {
    name: 'get_styling_recommendations',
    description: 'Generate customized outfit recommendations and lookbook gap analysis from the wardrobe database.',
    inputSchema: {
      type: 'object',
      properties: {
        weather: {
          type: 'string',
          description: 'Current weather context (e.g. "Chilly and raining", "75°F and Sunny").',
        },
        event: {
          type: 'string',
          description: 'The type of event or context (e.g. "casual coffee meeting", "formal dinner", "date night").',
        },
        lookbook: {
          type: 'string',
          description: 'Optional styling aesthetic goal or target lookbook reference (e.g. "minimalist warm tones").',
        },
      },
      required: ['weather', 'event'],
    },
  },
  {
    name: 'add_wardrobe_item',
    description: 'Directly add a new item record and its primary profile image to the wardrobe archive.',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'Publicly accessible URL to the item photo' },
        category: { type: 'string', enum: ['Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Tailoring'] },
        sub_category: { type: 'string', description: 'e.g. T-Shirt, Chinos, Chelsea Boots, Denim Jacket' },
        brand: { type: 'string', description: 'Brand name or designer' },
        color_family: { type: 'string', description: 'e.g. Olive, Beige, Black' },
        color_hex: { type: 'string', description: 'Nearest hexadecimal swatch code (e.g. #556b2f)' },
        tonal_value: { type: 'string', enum: ['Light', 'Medium', 'Dark'] },
        fabric_type: { type: 'string', description: 'e.g. Linen, Denim, Knitwear, Wool' },
        fit_block: { type: 'string', description: 'e.g. Slim, Regular, Relaxed, Tailored' },
        status: { type: 'string', enum: ['Active', 'Donate', 'Archive'] },
        notes: { type: 'string', description: 'Any fitting context or notes' },
        price: { type: 'number', description: 'Purchase price in dollars' },
      },
      required: ['image_url', 'category', 'sub_category', 'color_family'],
    },
  },
  {
    name: 'delete_wardrobe_item',
    description: 'Remove an item from the wardrobe archive database by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The UUID of the item to delete.' },
      },
      required: ['id'],
    },
  },
];

// Execute the tool logic against Supabase / Gemini
async function executeTool(name: string, args: any) {
  try {
    switch (name) {
      case 'suggest_outfit': {
        const { weather, occasion, vibe } = (args || {}) as {
          weather: string;
          occasion: string;
          vibe?: string;
        };

        if (!weather || typeof weather !== 'string') throw new Error('Missing required "weather" parameter.');
        if (!occasion || typeof occasion !== 'string') throw new Error('Missing required "occasion" parameter.');

        // Select ONLY needed columns, cap at 200 rows
        const { data: rawItems, error } = await supabase
          .from('garments')
          .select('id, category, sub_category, brand, color_family, hex_code, tonal_value, fabric_type, fit_block, notes')
          .eq('status', 'Active')
          .limit(200);

        if (error) throw new Error(error.message);
        const garments = (rawItems || []) as GarmentRecord[];
        if (garments.length === 0) {
          return {
            content: [{ type: 'text', text: 'Closet is empty. No active clothes found to compose an outfit.' }],
            structuredContent: { outfit: [], alternates: [], reasoning: 'No active garments available.' },
          };
        }

        const byCategory = (cat: string) =>
          garments.filter((g) => g.category.toLowerCase() === cat.toLowerCase());

        const tops = byCategory('Tops');
        const bottoms = byCategory('Bottoms');
        const footwear = byCategory('Footwear');
        const outerwear = byCategory('Outerwear');
        const tailoring = byCategory('Tailoring');

        // Check if weather/occasion warrants outerwear or tailoring
        const isColdOrRainy =
          /\b([0-3]?[0-9]|4[0-9]|5[0-5])\b/i.test(weather) || /cold|chilly|rain|snow|wind/i.test(weather);
        const isFormal = /formal|corporate|business|dinner|gala/i.test(occasion);

        // Deterministic composition using ported rules
        const candidateTopPool = tops.length > 0 ? tops : tailoring;
        const candidateBottomPool = bottoms;
        const candidateShoesPool = footwear;

        interface ScoredCombo {
          score: number;
          items: GarmentRecord[];
          layer?: GarmentRecord;
        }
        const scoredCombos: ScoredCombo[] = [];

        for (const top of candidateTopPool.slice(0, 10)) {
          for (const bottom of candidateBottomPool.slice(0, 10)) {
            for (const shoe of candidateShoesPool.slice(0, 5)) {
              const comboItems = [top, bottom, shoe];
              let layerItem: GarmentRecord | undefined;

              if (isColdOrRainy && outerwear.length > 0) {
                layerItem = outerwear[0];
                comboItems.push(layerItem);
              } else if (isFormal && tailoring.length > 0 && top.category.toLowerCase() !== 'tailoring') {
                layerItem = tailoring[0];
                comboItems.push(layerItem);
              }

              const score = scoreOutfit(comboItems, { weather, occasion, vibe });
              scoredCombos.push({ score, items: comboItems, layer: layerItem });
            }
          }
        }

        scoredCombos.sort((a, b) => b.score - a.score);
        const bestCombo = scoredCombos[0] || {
          items: [garments[0]],
          score: 1,
        };
        const runnerUpCombo = scoredCombos[1];

        // Format compact candidates representation for Gemini
        const compactSelection = garments.slice(0, 60).map((g) => ({
          id: g.id,
          category: g.category,
          sub_category: g.sub_category,
          brand: g.brand,
          color_family: g.color_family,
          tonal_value: g.tonal_value,
          fabric_type: g.fabric_type,
          fit_block: g.fit_block,
        }));

        let resultPayload: {
          outfit: Array<{
            id: string;
            category: string;
            sub_category: string;
            brand: string | null;
            color_family: string;
            reason: string;
          }>;
          alternates: Array<{
            id: string;
            category: string;
            sub_category: string;
            brand: string | null;
            color_family: string;
            reason: string;
          }>;
          reasoning: string;
        } | null = null;

        if (ai) {
          try {
            const prompt = `You are an elite stylist. Select one outfit (Tops, Bottoms, Footwear, and optional Outerwear/Tailoring) from this compact wardrobe inventory for the given context.

Context:
- Weather: ${weather}
- Occasion: ${occasion}
- Vibe: ${vibe || 'effortless modern'}

Candidate Garments (ID, category, sub_category, brand, color, tone, fabric, fit):
${JSON.stringify(compactSelection)}

Return a strict JSON object with:
{
  "outfit": [
    { "id": "<garment_id>", "category": "<cat>", "sub_category": "<sub>", "brand": "<brand>", "color_family": "<color>", "reason": "<why chosen>" }
  ],
  "alternates": [
    { "id": "<garment_id>", "category": "<cat>", "sub_category": "<sub>", "brand": "<brand>", "color_family": "<color>", "reason": "<why good alternate>" }
  ],
  "reasoning": "<Summary of styling coherence, silhouette, and weather suitability>"
}`;

            const response = await ai.models.generateContent({
              model: GEMINI_MODEL,
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
              },
            });

            if (response.text) {
              const parsed = JSON.parse(response.text);
              const validIds = new Set(garments.map((g) => g.id));
              const validOutfit = Array.isArray(parsed.outfit) && parsed.outfit.every((item: any) => validIds.has(item.id));
              if (validOutfit) {
                resultPayload = {
                  outfit: parsed.outfit,
                  alternates: Array.isArray(parsed.alternates)
                    ? parsed.alternates.filter((item: any) => validIds.has(item.id))
                    : [],
                  reasoning: parsed.reasoning || 'Outfit balanced for occasion and weather.',
                };
              }
            }
          } catch (geminiErr: any) {
            console.warn('Gemini styling call failed, using rule-based composition fallback:', geminiErr.message);
          }
        }

        // Fallback to pure rule scoring if AI was unavailable or failed
        if (!resultPayload) {
          const makeItem = (g: GarmentRecord, reason: string) => ({
            id: g.id,
            category: g.category,
            sub_category: g.sub_category,
            brand: g.brand,
            color_family: g.color_family,
            reason,
          });

          const outfitItems = bestCombo.items.map((g) =>
            makeItem(
              g,
              `Matches ${weather} weather and ${occasion} formality (${g.tonal_value || 'balanced'} tone, ${g.fabric_type || 'standard'} fabric).`
            )
          );

          const alternates = runnerUpCombo
            ? runnerUpCombo.items
                .filter((g) => !bestCombo.items.some((b) => b.id === g.id))
                .map((g) => makeItem(g, `Alternative ${g.category.toLowerCase()} pairing for varying vibe.`))
            : [];

          resultPayload = {
            outfit: outfitItems,
            alternates,
            reasoning: `Structured ${vibe || 'classic'} outfit selected: balanced tone contrast and silhouette harmony for ${occasion} in ${weather}.`,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(resultPayload, null, 2),
            },
          ],
          structuredContent: resultPayload,
        };
      }

      case 'get_garment': {
        const id = validateUuid(args?.id, 'id');
        const { data: garment, error } = await supabase.from('garments').select('*').eq('id', id).single();

        if (error) throw new Error(error.message);
        if (!garment) throw new Error(`Garment with ID ${id} not found.`);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(garment, null, 2),
            },
          ],
          structuredContent: garment,
        };
      }

      case 'search_wardrobe': {
        const { category, color_family, fabric_type, tags } = (args || {}) as {
          category?: string;
          color_family?: string;
          fabric_type?: string;
          tags?: string;
        };

        const rawLimit = Number(args?.limit);
        const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20, 1), 100);

        let query = supabase
          .from('garments')
          .select('id, sub_category, brand, color_family, hex_code, tonal_value')
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
        if (tags && typeof tags === 'string' && tags.trim()) {
          const kw = tags.trim();
          query = query.or(`notes.ilike.%${kw}%,sub_category.ilike.%${kw}%,brand.ilike.%${kw}%`);
        }

        const { data, error } = await query.limit(limit);
        if (error) throw new Error(error.message);

        const results = data || [];
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
          structuredContent: results,
        };
      }

      case 'log_wear': {
        const rawIds = args?.garment_ids;
        if (!Array.isArray(rawIds) || rawIds.length === 0) {
          throw new Error('Missing or invalid "garment_ids": must be a non-empty array of UUIDs.');
        }

        const validatedIds = rawIds.map((id, idx) => validateUuid(id, `garment_ids[${idx}]`));

        let wornAt: string;
        if (args?.worn_at) {
          const parsedDate = new Date(args.worn_at);
          if (isNaN(parsedDate.getTime())) {
            throw new Error(`Invalid "worn_at" date format: "${args.worn_at}". Must be valid ISO date.`);
          }
          wornAt = parsedDate.toISOString();
        } else {
          wornAt = new Date().toISOString();
        }

        const rowsToInsert = validatedIds.map((garmentId) => ({
          garment_id: garmentId,
          worn_at: wornAt,
        }));

        const { data, error } = await supabase.from('wear_logs').insert(rowsToInsert).select('id');
        if (error) throw new Error(error.message);

        const count = data ? data.length : validatedIds.length;
        const res = { success: true, count, worn_at: wornAt, garment_ids: validatedIds };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(res, null, 2),
            },
          ],
          structuredContent: res,
        };
      }

      case 'wardrobe_stats': {
        // Fetch garments and wear_logs
        const [{ data: garmentsData, error: gError }, { data: wearLogsData, error: wError }] = await Promise.all([
          supabase.from('garments').select('id, category, sub_category, brand, status, price'),
          supabase.from('wear_logs').select('id, garment_id, worn_at'),
        ]);

        if (gError) throw new Error(gError.message);
        if (wError) throw new Error(wError.message);

        const garments = garmentsData || [];
        const wearLogs = wearLogsData || [];

        // Category & status counts
        const categoryCounts: Record<string, number> = {};
        const statusCounts: Record<string, number> = {};
        for (const g of garments) {
          const cat = g.category || 'Unknown';
          const stat = g.status || 'Unknown';
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
          statusCounts[stat] = (statusCounts[stat] || 0) + 1;
        }

        // Wears in last 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        let totalWearsLast30Days = 0;
        const wearCountByGarment: Record<string, number> = {};

        for (const log of wearLogs) {
          if (log.worn_at && new Date(log.worn_at) >= thirtyDaysAgo) {
            totalWearsLast30Days++;
          }
          if (log.garment_id) {
            wearCountByGarment[log.garment_id] = (wearCountByGarment[log.garment_id] || 0) + 1;
          }
        }

        // Top 5 most-worn items
        const garmentMap = new Map(garments.map((g) => [g.id, g]));
        const sortedWearEntries = Object.entries(wearCountByGarment).sort(([, a], [, b]) => b - a);

        const topWornItems = sortedWearEntries.slice(0, 5).map(([id, wearCount]) => {
          const g = garmentMap.get(id);
          return {
            id,
            category: g?.category || 'Unknown',
            sub_category: g?.sub_category || 'Item',
            brand: g?.brand || null,
            wear_count: wearCount,
          };
        });

        // Cost-per-wear for items with price > 0
        const costPerWear = garments
          .filter((g) => g.price !== null && g.price !== undefined && Number(g.price) > 0)
          .map((g) => {
            const price = Number(g.price);
            const wears = wearCountByGarment[g.id] || 0;
            return {
              id: g.id,
              sub_category: g.sub_category,
              brand: g.brand || null,
              price,
              wear_count: wears,
              cost_per_wear: wears > 0 ? Number((price / wears).toFixed(2)) : null,
            };
          })
          .sort((a, b) => {
            if (a.cost_per_wear === null) return 1;
            if (b.cost_per_wear === null) return -1;
            return b.cost_per_wear - a.cost_per_wear;
          });

        const stats = {
          category_counts: categoryCounts,
          status_counts: statusCounts,
          total_wears_last_30_days: totalWearsLast30Days,
          top_worn_items: topWornItems,
          cost_per_wear: costPerWear,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(stats, null, 2),
            },
          ],
          structuredContent: stats,
        };
      }

      case 'list_wardrobe': {
        const { category, status } = (args || {}) as { category?: string; status?: string };
        const rawLimit = Number(args?.limit);
        const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20, 1), 100);
        const offset = Math.max(Number(args?.offset) || 0, 0);

        // Select ONLY display columns instead of select(*)
        let query = supabase
          .from('garments')
          .select('id, category, sub_category, brand, color_family, hex_code, tonal_value, fabric_type, fit_block, status, price, created_at');

        if (category && category !== 'All') {
          query = query.eq('category', category);
        }
        if (status && status !== 'All') {
          query = query.eq('status', status);
        } else if (!status) {
          query = query.eq('status', 'Active');
        }

        const { data, error } = await query
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw new Error(error.message);
        const items = data || [];
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(items, null, 2),
            },
          ],
          structuredContent: items,
        };
      }

      case 'get_styling_recommendations': {
        const { weather, event, lookbook } = (args || {}) as {
          weather: string;
          event: string;
          lookbook?: string;
        };

        if (!weather || !event) throw new Error('Missing required "weather" or "event" parameter.');

        // Cap garment selection to max 150 rows with compact columns
        const { data: items, error } = await supabase
          .from('garments')
          .select('id, category, sub_category, brand, color_family, hex_code, tonal_value, fabric_type, fit_block, status, price, created_at')
          .eq('status', 'Active')
          .limit(150);

        if (error) throw new Error(error.message);
        if (!items || items.length === 0) {
          return {
            content: [{ type: 'text', text: 'Closet is empty. No clothes found to style!' }],
            structuredContent: { text: 'Closet is empty.', referenced_item_ids: [] },
          };
        }

        if (!ai) {
          throw new Error('GEMINI_API_KEY is not configured on the server.');
        }

        // Minified pipe-delimited format to save prompt tokens
        const compactInventory = items
          .map(
            (i: any) =>
              `${i.id}|${i.category}|${i.sub_category}|${i.brand || ''}|${i.color_family}|${i.tonal_value || ''}|${i.fabric_type || ''}|${i.fit_block || ''}`
          )
          .join('\n');

        const promptText = `
You are an expert personal fashion stylist. Generate outfit combinations and styling advice from these wardrobe items:

Context:
- Weather: ${weather}
- Event: ${event}
- Target Lookbook: ${lookbook || 'balanced modern style'}

Wardrobe Inventory (Format: id|category|sub_category|brand|color|tone|fabric|fit):
${compactInventory}

Styling rules:
1. Balance contrasts (light vs dark) or use sophisticated tonal harmonies.
2. Coordinate fit and silhouette.
3. Match weather conditions and event formality.
4. MANDATORY: Outfits must specify the exact item UUIDs.

Provide 2 complete outfit options (using item IDs) and styling advice. Also list 2 gaps in their wardrobe to achieve the target lookbook. Return results in clean markdown.
`;

        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: promptText,
        });

        const recommendationText = response.text || 'Failed to generate recommendations.';

        // Extract referenced UUIDs that match items in the wardrobe
        const wardrobeIds = new Set(items.map((i: any) => i.id));
        const matchedUuids = Array.from(
          new Set(
            (recommendationText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) ||
              []
            ).filter((id) => wardrobeIds.has(id.toLowerCase()))
          )
        );

        const resultObj = {
          recommendation: recommendationText,
          referenced_item_ids: matchedUuids,
        };

        return {
          content: [
            {
              type: 'text',
              text: recommendationText,
            },
          ],
          structuredContent: resultObj,
        };
      }

      case 'add_wardrobe_item': {
        const { image_url, color_hex, notes, price, ...rest } = args as any;

        // SCHEMA FIX: Do NOT insert raw_image_url into garments!
        const garmentPayload: Record<string, any> = {
          hex_code: color_hex || null,
          notes: notes || null,
          ...(price !== undefined && price !== null && !isNaN(Number(price)) ? { price: Number(price) } : {}),
          ...rest,
        };

        // Remove any legacy image keys from garment payload
        delete garmentPayload.raw_image_url;
        delete garmentPayload.processed_image_url;
        delete garmentPayload.image_url;

        const { data: garment, error: gError } = await supabase
          .from('garments')
          .insert([garmentPayload])
          .select()
          .single();

        if (gError) throw new Error(`Garment insert failed: ${gError.message}`);

        let imageNotice: string | null = null;
        if (image_url && typeof image_url === 'string' && image_url.trim()) {
          const { error: imgError } = await supabase.from('garment_images').insert([
            {
              garment_id: garment.id,
              storage_path: image_url.trim(),
              is_primary_profile: true,
              asset_type: 'profile',
            },
          ]);

          if (imgError) {
            console.warn('Garment image record insert failed:', imgError.message);
            imageNotice = `Image record insert failed: ${imgError.message}`;
          }
        }

        const responsePayload = {
          garment,
          ...(imageNotice ? { image_warning: imageNotice } : {}),
        };

        return {
          content: [
            {
              type: 'text',
              text: `Successfully added garment to archive! Item:\n${JSON.stringify(responsePayload, null, 2)}`,
            },
          ],
          structuredContent: responsePayload,
        };
      }

      case 'delete_wardrobe_item': {
        const id = validateUuid(args?.id, 'id');
        const { error } = await supabase.from('garments').delete().eq('id', id);

        if (error) throw new Error(error.message);
        const result = { success: true, deleted_id: id };
        return {
          content: [
            {
              type: 'text',
              text: `Successfully deleted garment ID: ${id}`,
            },
          ],
          structuredContent: result,
        };
      }

      default:
        throw new Error(`Tool not found: ${name}`);
    }
  } catch (err: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error executing tool ${name}: ${err.message}`,
        },
      ],
      structuredContent: { error: err.message },
    };
  }
}

// JSON-RPC 2.0 Handler for MCP
async function handleJsonRpc(payload: any) {
  const { jsonrpc, method, id, params } = payload;
  if (jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } };
  }

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'wardrobe-stylist-mcp',
              version: '1.0.0',
            },
          },
        };

      case 'notifications/initialized':
        return null;

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: TOOLS_MANIFEST,
          },
        };

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        const result = await executeTool(name, args);
        return {
          jsonrpc: '2.0',
          id,
          result,
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  } catch (err: any) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err.message || 'Internal error' },
    };
  }
}

// Express Server
const app = express();
app.use(cors());
app.use(express.json());

// PRIORITY 1: Timing-safe Authentication Middleware supporting Bearer and query param (for EventSource)
function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.query?.token && typeof req.query.token === 'string') {
    token = req.query.token.trim();
  } else if (req.query?.secret && typeof req.query.secret === 'string') {
    token = req.query.secret.trim();
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. Missing Bearer token or token query parameter.' });
  }

  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(MCP_SECRET);

  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    return res.status(401).json({ error: 'Unauthorized. Invalid Bearer token.' });
  }

  next();
}

// REST endpoints (For Poke Custom Connector support) - Authenticated
app.get('/tools', authenticate, (req, res) => {
  res.json({ tools: TOOLS_MANIFEST });
});

app.post('/tools/:toolName', authenticate, async (req, res) => {
  const { toolName } = req.params;
  const args = req.body || {};
  try {
    const result = await executeTool(toolName, args);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// SSE Session Manager - Authenticated
const sseConnections = new Map<string, express.Response>();

app.get('/sse', authenticate, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const sessionId = Math.random().toString(36).substring(2, 15);
  sseConnections.set(sessionId, res);

  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https' || req.headers['x-forwarded-ssl'] === 'on';
  const resolvedProto = isSecure ? 'https' : 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');

  const relativeMessageUrl = `/message?sessionId=${sessionId}&session_id=${sessionId}`;
  const absoluteMessageUrl = `${resolvedProto}://${host}${relativeMessageUrl}`;

  res.write(`event: endpoint\ndata: ${absoluteMessageUrl}\n\n`);

  req.on('close', () => {
    sseConnections.delete(sessionId);
  });
});

app.post('/message', authenticate, async (req, res) => {
  const sessionId = (req.query.sessionId || req.query.session_id) as string;

  if (!sessionId) {
    res.status(400).json({ error: 'Missing sessionId query parameter.' });
    return;
  }

  const clientRes = sseConnections.get(sessionId);
  if (!clientRes) {
    res.status(404).json({ error: 'Active SSE connection session not found.' });
    return;
  }

  const payload = req.body;
  const responsePayload = await handleJsonRpc(payload);

  if (responsePayload) {
    clientRes.write(`event: message\ndata: ${JSON.stringify(responsePayload)}\n\n`);
  }

  res.status(202).end();
});

// Health check with real DB query (Open endpoint)
app.get('/health', async (req, res) => {
  try {
    const { error } = await supabase.from('garments').select('id', { count: 'exact', head: true }).limit(1);
    const dbStatus = error ? 'error' : 'ok';
    const status = error ? 'degraded' : 'healthy';
    res.status(error ? 503 : 200).json({
      status,
      db: dbStatus,
      tools: TOOLS_MANIFEST.length,
    });
  } catch {
    res.status(503).json({
      status: 'degraded',
      db: 'error',
      tools: TOOLS_MANIFEST.length,
    });
  }
});

// Base path check (Open endpoint)
app.get('/', (req, res) => {
  res.status(200).send('Wardrobe Stylist MCP Server is running over SSE and REST.');
});

app.listen(port, () => {
  console.log(`Wardrobe Stylist MCP Server listening on port ${port}`);
  console.log(`SSE Route: http://localhost:${port}/sse`);
  console.log(`REST Route: http://localhost:${port}/tools`);
});
