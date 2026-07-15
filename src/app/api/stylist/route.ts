import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { logTelemetry } from '@/lib/telemetry';
import { ok } from '@/lib/api';

const geminiApiKey = process.env.GEMINI_API_KEY || '';
const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

export async function POST(request: Request) {
  try {
    if (!ai) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured on the server.' },
        { status: 500 }
      );
    }

    const { weather, event, lookbook, items } = await request.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'No wardrobe items provided for styling analysis.' },
        { status: 400 }
      );
    }

    // Filter only Active items
    const activeItems = items.filter((item: any) => item.status === 'Active');

    if (activeItems.length === 0) {
      return NextResponse.json(
        { error: 'No active wardrobe items found. Complete the ingestion process first.' },
        { status: 400 }
      );
    }

    // Minified Data Serialization Protocol (CSV-like plain text string)
    // Format: id|category|sub_category|color_family|tonal_value|fabric_type|fit_block
    const serializedGarments = activeItems
      .map((item: any) => {
        const id = item.id || '';
        const cat = item.category || '';
        const sub = item.sub_category || '';
        const col = item.color_family || '';
        const tone = item.tonal_value || '';
        const fab = item.fabric_type || '';
        const fit = item.fit_block || '';
        return `${id}|${cat}|${sub}|${col}|${tone}|${fab}|${fit}`;
      })
      .join('\n');

    const promptText = `
      You are an expert personal fashion stylist. Recommend outfit options for your client.
      
      Client Details:
      - Current Weather: ${weather || 'Any weather'}
      - Event / Vibe: ${event || 'Casual'}
      - Target Lookbook / Aesthetic: ${lookbook || 'Clean, balanced, modern style'}
      
      Wardrobe Items Available (Serialized Format: id|category|sub_category|color|tonality|fabric|fit):
      ${serializedGarments}
      
      Styling Rules:
      1. Contrast & Tonality: Ensure outfits use balanced contrast (e.g. light top with dark bottoms) or varying tonal shades of the same colors.
      2. Silhouette & Fit: Balance shapes (e.g. relaxed top with tapered bottom, or structured layers).
      3. Weather & Event: Align fits and fabrics (e.g. linen for heat, wool/layering for cold) with event formality.
      4. **MANDATORY STRUCTURE**: Every outfit MUST include:
         - At least one item from category "Tops" or "Tailoring" (the top half)
         - At least one item from category "Bottoms" (the bottom half)
         - One item from category "Footwear" if any footwear exists in the wardrobe
         - Optionally one item from category "Outerwear" if weather warrants
         An outfit that lacks a top OR a bottom is INVALID and will be rejected. Do not generate sweaters without a shirt underneath, or shorts without a shirt.
      5. Refer to the items ONLY by their exact UUID from the list.

      Suggest 4 to 6 distinct outfits. For each outfit, list the UUIDs of the items used. Every listed UUID must come from the wardrobe above.
      Also list 2 specific wardrobe gaps (staples or colors missing) to achieve their lookbook style.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: promptText,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            outfits: {
              type: 'array',
              description: 'Recommended outfits',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  item_ids: { 
                    type: 'array', 
                    description: 'UUIDs of the items matching the serialized garment ids',
                    items: { type: 'string' } 
                  },
                  styling_reasoning: { type: 'string', description: 'Why this outfit is perfect for this context.' }
                },
                required: ['name', 'item_ids', 'styling_reasoning']
              }
            },
            gap_analysis: {
              type: 'string',
              description: 'What key pieces or colors the closet is missing to achieve this lookbook style.'
            },
            general_tips: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['outfits', 'gap_analysis', 'general_tips']
        }
      }
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error('Empty response received from stylist engine.');
    }

    const recommendations = JSON.parse(responseText);

    // Log Telemetry
    const promptTokens = response.usageMetadata?.promptTokenCount || 0;
    const candidatesTokens = response.usageMetadata?.candidatesTokenCount || 0;
    await logTelemetry('Gemini_Stylist_Engine', promptTokens, candidatesTokens, { itemsCount: activeItems.length });

    return ok({ recommendations });
  } catch (error: any) {
    console.error('Stylist endpoint error:', error);
    return NextResponse.json(
      { error: error.message || 'An error occurred during styling analysis.' },
      { status: 500 }
    );
  }
}
