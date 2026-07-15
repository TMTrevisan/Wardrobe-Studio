import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import express from 'express';
import cors from 'cors';
import ws from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const port = process.env.PORT || 10000;

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
  realtime: {
    transport: ws as any,
  },
});

// Initialize Gemini Client
const geminiApiKey = process.env.GEMINI_API_KEY || '';
const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

// Exposed Tools list matching the schema
const TOOLS_MANIFEST = [
  {
    name: 'list_wardrobe',
    description: 'List all items currently stored in the wardrobe archive database.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter items by category (e.g. Tops, Bottoms, Outerwear, Footwear, Tailoring)',
        },
        status: {
          type: 'string',
          description: 'Filter items by status (e.g. Active, Donate, Sell). Defaults to "All".',
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
          description: 'Optional styling aesthetic goal or target lookbook reference (e.g. "minimalist warm tones", "structured silhouettes").',
        },
      },
      required: ['weather', 'event'],
    },
  },
  {
    name: 'add_wardrobe_item',
    description: 'Directly add a new item record to the wardrobe database.',
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
      case 'list_wardrobe': {
        const { category, status } = (args || {}) as { category?: string; status?: string };
        let query = supabase.from('garments').select('*');

        if (category && category !== 'All') {
          query = query.eq('category', category);
        }
        if (status && status !== 'All') {
          query = query.eq('status', status);
        } else if (!status) {
          query = query.eq('status', 'Active');
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw new Error(error.message);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'get_styling_recommendations': {
        const { weather, event, lookbook } = args as { weather: string; event: string; lookbook?: string };

        const { data: items, error } = await supabase
          .from('garments')
          .select('*')
          .eq('status', 'Active');

        if (error) throw new Error(error.message);
        if (!items || items.length === 0) {
          return {
            content: [{ type: 'text', text: 'Closet is empty. No clothes found to style!' }],
          };
        }

        if (!ai) {
          throw new Error('GEMINI_API_KEY is not configured on the server.');
        }

        const promptText = `
          You are an expert personal fashion stylist. Generate outfit combinations and styling advice from these closet items:
          
          Context:
          - Weather: ${weather}
          - Event: ${event}
          - Target Lookbook: ${lookbook || 'balanced modern style'}
          
          Closet Database:
          ${JSON.stringify(items, null, 2)}
          
          Styling rules:
          1. Balance contrasts (light vs dark) or use sophisticated tonal harmonies.
          2. Fit coordination (e.g. relax top with straight bottoms).
          3. Match the weather and event formality.
          
          Provide 2 complete outfit options (using item IDs) and styling advice. Also list 2 gaps in their wardrobe to achieve the target lookbook. Return results in clean markdown.
        `;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: promptText,
        });

        return {
          content: [
            {
              type: 'text',
              text: response.text || 'Failed to generate recommendations.',
            },
          ],
        };
      }

      case 'add_wardrobe_item': {
        const { image_url, color_hex, ...rest } = args as any;
        const itemData = {
          raw_image_url: image_url,
          hex_code: color_hex,
          ...rest
        };
        const { data, error } = await supabase
          .from('garments')
          .insert([itemData])
          .select()
          .single();

        if (error) throw new Error(error.message);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully added garment to archive! Item:\n${JSON.stringify(data, null, 2)}`,
            },
          ],
        };
      }

      case 'delete_wardrobe_item': {
        const { id } = args as { id: string };
        const { error } = await supabase.from('garments').delete().eq('id', id);

        if (error) throw new Error(error.message);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully deleted garment ID: ${id}`,
            },
          ],
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

// Authentication Middleware
const MCP_SECRET = process.env.MCP_SECRET || process.env.POKE_API_KEY || '';

function authenticate(req: any, res: any, next: any) {
  if (!MCP_SECRET) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. Missing or invalid Bearer token.' });
  }
  const token = authHeader.substring(7).trim();
  if (token !== MCP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized. Invalid Bearer token.' });
  }
  next();
}

// Simple REST endpoints (For Poke Custom Connector support)
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

// SSE Session Manager (For standard MCP Client support)
const sseConnections = new Map<string, any>();

app.get('/sse', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const sessionId = Math.random().toString(36).substring(2, 15);
  sseConnections.set(sessionId, res);

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const absoluteMessageUrl = `${protocol}://${host}/message?sessionId=${sessionId}`;

  res.write(`event: endpoint\ndata: ${absoluteMessageUrl}\n\n`);

  req.on('close', () => {
    sseConnections.delete(sessionId);
  });
});

app.post('/message', async (req, res) => {
  const { sessionId } = req.query as { sessionId?: string };

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

// Health & base path checks
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', mcp: 'wardrobe-stylist-mcp' });
});

app.get('/', (req, res) => {
  res.status(200).send('Wardrobe Stylist MCP Server is running over SSE and REST.');
});

app.listen(port, () => {
  console.log(`Wardrobe Stylist MCP Server listening on port ${port}`);
  console.log(`SSE Route: http://localhost:${port}/sse`);
  console.log(`REST Route: http://localhost:${port}/tools`);
});
