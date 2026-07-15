import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
        image_url: { type: 'string', description: 'Public URL of the garment photo' }
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
        description: { type: 'string', description: 'Details of the garments e.g. olive long-sleeve linen shirt tucked into cream cotton trousers and brown loafers.' }
      },
      required: ['description'],
    },
  },
  {
    name: 'list_garments',
    description: 'Query all garments optionally filtered by category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional. Valid options: Tops, Bottoms, Outerwear, Footwear, Tailoring' }
      }
    }
  },
  {
    name: 'delete_garment',
    description: 'Permanently remove a garment from inventory using its UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The unique UUID of the garment to delete' }
      },
      required: ['id']
    }
  }
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

    if (!authHeader || authHeader !== `Bearer ${systemToken}`) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized access.' }, id: null }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { method, params, id } = body;

    // 2. Handle JSON-RPC 2.0 Handshakes
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
          // Fetch garments
          const { data: garments, error } = await supabase
            .from('garments')
            .select('*')
            .eq('status', 'Active');

          if (error) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32002, message: error.message },
              id,
            });
          }

          // Minified Data Serialization Protocol
          // ID|Category|Sub-Category|Color|Fabric|Fit
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
          
          if (category) {
            const validCategories = ['Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Tailoring'];
            if (!validCategories.includes(category)) {
              return NextResponse.json({
                jsonrpc: '2.0',
                error: { 
                  code: -32602, 
                  message: `Invalid Category filter. Must be one of: ${validCategories.join(', ')}` 
                },
                id
              });
            }
          }

          let query = supabase.from('garments').select('*').eq('status', 'Active');
          if (category) {
            query = query.eq('category', category);
          }

          const { data: garments, error } = await query;
          if (error) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32004, message: error.message },
              id
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
                text: serialized || 'No items found matching the filters.'
              }]
            },
            id
          });
        }

        case 'delete_garment': {
          const { id: itemId } = args || {};

          // UUID validation regex check
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          if (!itemId || !uuidRegex.test(itemId)) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { 
                code: -32602, 
                message: 'Invalid UUID format provided for deletion. Please check the garment ID and try again.' 
              },
              id
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
              id
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
              id
            });
          }

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [{
                type: 'text',
                text: `Success! Garment ID ${itemId} has been permanently deleted from your inventory.`
              }]
            },
            id
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
