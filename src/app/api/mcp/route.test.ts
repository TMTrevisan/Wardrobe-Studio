import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

// Mock supabase
const mockSupabaseQuery: any = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseQuery),
  },
}));

// Mock @google/genai
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function () {
    return {
      models: {
        generateContent: mockGenerateContent,
      },
    };
  }),
}));

const TEST_TOKEN = 'test-mcp-secret-token-1234567890';

function createMcpRequest(body: any, token: string | null = TEST_TOKEN): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MCP_AUTH_TOKEN = TEST_TOKEN;
    delete process.env.GEMINI_API_KEY;
  });

  describe('Authentication', () => {
    it('returns 500 if MCP_AUTH_TOKEN is not configured', async () => {
      delete process.env.MCP_AUTH_TOKEN;
      const req = createMcpRequest({ method: 'tools/list', id: 1 });
      const res = await POST(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe(-32001);
      expect(json.error.message).toContain('MCP_AUTH_TOKEN is missing');
    });

    it('returns 401 if authorization header is missing', async () => {
      const req = createMcpRequest({ method: 'tools/list', id: 1 }, null);
      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe(-32001);
    });

    it('returns 401 if token is incorrect', async () => {
      const req = createMcpRequest({ method: 'tools/list', id: 1 }, 'wrong-token');
      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe(-32001);
    });
  });

  describe('Handshake & Discovery', () => {
    it('handles initialize method with protocol 2024-11-05 and serverInfo', async () => {
      const req = createMcpRequest({ method: 'initialize', id: 'init-1' });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.jsonrpc).toBe('2.0');
      expect(json.id).toBe('init-1');
      expect(json.result).toEqual({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'wardrobe-studio-mcp', version: '2.0.0' },
      });
    });

    it('handles notifications/initialized with 204 empty response', async () => {
      const req = createMcpRequest({ method: 'notifications/initialized' });
      const res = await POST(req);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    });

    it('handles tools/list returning all 10 tools', async () => {
      const req = createMcpRequest({ method: 'tools/list', id: 2 });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      const toolNames = json.result.tools.map((t: any) => t.name);
      expect(toolNames).toEqual([
        'fetch_minified_wardrobe',
        'add_garment_to_inventory',
        'generate_outfit_visual',
        'list_garments',
        'delete_garment',
        'suggest_outfit',
        'get_garment',
        'search_wardrobe',
        'log_wear',
        'wardrobe_stats',
      ]);
    });
  });

  describe('fetch_minified_wardrobe', () => {
    it('queries Active garments with explicit columns and limit 300', async () => {
      const mockGarments = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          category: 'Tops',
          sub_category: 'Oxford Shirt',
          color_family: 'Blue',
          tonal_value: 'Light',
          fabric_type: 'Cotton',
          fit_block: 'Slim',
        },
      ];
      mockSupabaseQuery.limit.mockResolvedValueOnce({ data: mockGarments, error: null });

      const req = createMcpRequest({
        method: 'tools/call',
        params: { name: 'fetch_minified_wardrobe' },
        id: 3,
      });
      const res = await POST(req);
      const json = await res.json();

      expect(mockSupabaseQuery.select).toHaveBeenCalledWith(
        'id, category, sub_category, brand, color_family, tonal_value, fabric_type, fit_block, pattern, formality, season'
      );
      expect(mockSupabaseQuery.limit).toHaveBeenCalledWith(300);
      expect(json.result.content[0].text).toBe(
        '11111111-1111-4111-8111-111111111111|Tops|Oxford Shirt|Blue|Light|Cotton|Slim'
      );
    });
  });

  describe('list_garments', () => {
    it('applies limit and offset and orders by created_at desc', async () => {
      const mockGarments = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          category: 'Tops',
          sub_category: 'T-Shirt',
          brand: 'Uniqlo',
          color_family: 'White',
          fabric_type: 'Cotton',
        },
      ];
      mockSupabaseQuery.range.mockResolvedValueOnce({ data: mockGarments, error: null });

      const req = createMcpRequest({
        method: 'tools/call',
        params: {
          name: 'list_garments',
          arguments: { limit: 10, offset: 5 },
        },
        id: 4,
      });
      const res = await POST(req);
      const json = await res.json();

      expect(mockSupabaseQuery.select).toHaveBeenCalledWith(
        'id, category, sub_category, brand, color_family, hex_code, tonal_value, fabric_type, fit_block, status, price, created_at'
      );
      expect(mockSupabaseQuery.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockSupabaseQuery.range).toHaveBeenCalledWith(5, 14);
      expect(json.result.content[0].text).toContain('11111111-1111-4111-8111-111111111111|Tops|T-Shirt|White|Cotton|Uniqlo');
    });
  });

  describe('get_garment', () => {
    it('rejects invalid UUID', async () => {
      const req = createMcpRequest({
        method: 'tools/call',
        params: { name: 'get_garment', arguments: { id: 'not-a-uuid' } },
        id: 5,
      });
      const res = await POST(req);
      const json = await res.json();
      expect(json.error.code).toBe(-32602);
      expect(json.error.message).toContain('Invalid UUID');
    });

    it('returns garment row with projected columns', async () => {
      const mockGarment = {
        id: '22222222-2222-4222-8222-222222222222',
        user_id: '00000000-0000-0000-0000-000000000000',
        category: 'Bottoms',
        sub_category: 'Chinos',
        brand: 'J.Crew',
        color_family: 'Navy',
        hex_code: '#000080',
        tonal_value: 'Dark',
        fabric_type: 'Cotton',
        fit_block: 'Regular',
        status: 'Active',
        price: 85,
        created_at: '2026-01-01T00:00:00Z',
      };
      mockSupabaseQuery.single.mockResolvedValueOnce({ data: mockGarment, error: null });

      const req = createMcpRequest({
        method: 'tools/call',
        params: { name: 'get_garment', arguments: { id: mockGarment.id } },
        id: 6,
      });
      const res = await POST(req);
      const json = await res.json();

      expect(json.result.garment).toEqual(mockGarment);
      expect(JSON.parse(json.result.content[0].text)).toEqual(mockGarment);
    });
  });

  describe('search_wardrobe', () => {
    it('filters by category, color_family, and fabric_type', async () => {
      const mockGarments = [
        {
          id: '33333333-3333-4333-8333-333333333333',
          category: 'Tops',
          sub_category: 'Linen Shirt',
          brand: 'Incotex',
          color_family: 'Olive',
          fabric_type: 'Linen',
        },
      ];
      mockSupabaseQuery.limit.mockResolvedValueOnce({ data: mockGarments, error: null });

      const req = createMcpRequest({
        method: 'tools/call',
        params: {
          name: 'search_wardrobe',
          arguments: {
            category: 'Tops',
            color_family: 'Olive',
            fabric_type: 'Linen',
            limit: 5,
          },
        },
        id: 7,
      });
      const res = await POST(req);
      const json = await res.json();

      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('category', 'Tops');
      expect(mockSupabaseQuery.ilike).toHaveBeenCalledWith('color_family', '%Olive%');
      expect(mockSupabaseQuery.ilike).toHaveBeenCalledWith('fabric_type', '%Linen%');
      expect(mockSupabaseQuery.limit).toHaveBeenCalledWith(5);
      expect(json.result.garments).toEqual(mockGarments);
    });
  });

  describe('log_wear', () => {
    it('validates garment UUIDs and worn_at date, inserts logs', async () => {
      mockSupabaseQuery.select.mockResolvedValueOnce({
        data: [{ id: 'log-1' }, { id: 'log-2' }],
        error: null,
      });

      const validId1 = '44444444-4444-4444-8444-444444444444';
      const validId2 = '55555555-5555-4555-8555-555555555555';
      const req = createMcpRequest({
        method: 'tools/call',
        params: {
          name: 'log_wear',
          arguments: {
            garment_ids: [validId1, validId2],
            worn_at: '2026-10-01T12:00:00Z',
          },
        },
        id: 8,
      });
      const res = await POST(req);
      const json = await res.json();

      expect(json.result.logged).toBe(2);
      expect(mockSupabaseQuery.insert).toHaveBeenCalledWith([
        { garment_id: validId1, worn_at: '2026-10-01T12:00:00.000Z' },
        { garment_id: validId2, worn_at: '2026-10-01T12:00:00.000Z' },
      ]);
    });

    it('rejects invalid UUID in garment_ids', async () => {
      const req = createMcpRequest({
        method: 'tools/call',
        params: {
          name: 'log_wear',
          arguments: { garment_ids: ['invalid-id'] },
        },
        id: 9,
      });
      const res = await POST(req);
      const json = await res.json();
      expect(json.error.code).toBe(-32602);
      expect(json.error.message).toContain('Invalid UUID');
    });
  });

  describe('wardrobe_stats', () => {
    it('calculates counts, wears_last_30d, most_worn, and cost_per_wear', async () => {
      const mockGarments = [
        { id: 'g1', category: 'Tops', sub_category: 'Tee', brand: 'BrandA', status: 'Active', price: 50 },
        { id: 'g2', category: 'Bottoms', sub_category: 'Jeans', brand: 'BrandB', status: 'Active', price: 100 },
        { id: 'g3', category: 'Footwear', sub_category: 'Boots', brand: 'BrandC', status: 'Active', price: 0 },
      ];
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const mockWearLogs = [
        { id: 'w1', garment_id: 'g1', worn_at: tenDaysAgo },
        { id: 'w2', garment_id: 'g1', worn_at: tenDaysAgo },
        { id: 'w3', garment_id: 'g2', worn_at: tenDaysAgo },
      ];

      // Two queries in Promise.all
      mockSupabaseQuery.select
        .mockResolvedValueOnce({ data: mockGarments, error: null })
        .mockResolvedValueOnce({ data: mockWearLogs, error: null });

      const req = createMcpRequest({
        method: 'tools/call',
        params: { name: 'wardrobe_stats' },
        id: 10,
      });
      const res = await POST(req);
      const json = await res.json();

      expect(json.result.by_category).toEqual({ Tops: 1, Bottoms: 1, Footwear: 1 });
      expect(json.result.by_status).toEqual({ Active: 3 });
      expect(json.result.wears_last_30d).toBe(3);
      expect(json.result.most_worn[0]).toEqual({
        id: 'g1',
        sub_category: 'Tee',
        brand: 'BrandA',
        wears: 2,
      });
      // Cost per wear: g1 price 50 / 2 wears = 25.00, g2 price 100 / 1 wear = 100.00
      expect(json.result.cost_per_wear).toEqual([
        { id: 'g1', sub_category: 'Tee', price: 50, wears: 2, cpw: 25 },
        { id: 'g2', sub_category: 'Jeans', price: 100, wears: 1, cpw: 100 },
      ]);
    });
  });

  describe('suggest_outfit', () => {
    it('returns -32003 if GEMINI_API_KEY is missing', async () => {
      delete process.env.GEMINI_API_KEY;
      const req = createMcpRequest({
        method: 'tools/call',
        params: {
          name: 'suggest_outfit',
          arguments: { weather: '72F sunny', occasion: 'work lunch' },
        },
        id: 11,
      });
      const res = await POST(req);
      const json = await res.json();
      expect(json.error.code).toBe(-32003);
      expect(json.error.message).toBe('styling not configured');
    });

    it('calls Gemini and returns parsed JSON outfit recommendations', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      const mockGarments = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          category: 'Tops',
          sub_category: 'Linen Shirt',
          brand: 'Zara',
          color_family: 'White',
          hex_code: '#ffffff',
          tonal_value: 'Light',
          fabric_type: 'Linen',
          fit_block: 'Regular',
          pattern: 'Solid',
          formality: 'Smart Casual',
          season: ['Summer'],
        },
      ];
      mockSupabaseQuery.limit.mockResolvedValueOnce({ data: mockGarments, error: null });

      const aiResponse = {
        outfits: [
          {
            name: 'Summer Breeze',
            garment_ids: ['11111111-1111-4111-8111-111111111111'],
            reason: 'Breathable linen shirt matches warm weather.',
          },
        ],
        gap: 'Need lightweight trousers to pair with the linen shirt.',
      };
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(aiResponse),
      });

      const req = createMcpRequest({
        method: 'tools/call',
        params: {
          name: 'suggest_outfit',
          arguments: { weather: '80F sunny', occasion: 'casual brunch', vibe: 'relaxed' },
        },
        id: 12,
      });
      const res = await POST(req);
      const json = await res.json();

      expect(json.result.outfits).toEqual(aiResponse.outfits);
      expect(json.result.gap).toBe(aiResponse.gap);
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('falls back to raw text if AI response is not valid JSON', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      mockSupabaseQuery.limit.mockResolvedValueOnce({
        data: [{ id: '11111111-1111-4111-8111-111111111111' }],
        error: null,
      });

      mockGenerateContent.mockResolvedValueOnce({
        text: 'Non-JSON text response from model.',
      });

      const req = createMcpRequest({
        method: 'tools/call',
        params: {
          name: 'suggest_outfit',
          arguments: { weather: '60F breezy', occasion: 'walking the dog' },
        },
        id: 13,
      });
      const res = await POST(req);
      const json = await res.json();

      expect(json.result.content[0].text).toBe('Non-JSON text response from model.');
    });
  });

  describe('delete_garment', () => {
    it('deletes image relationships and garment row', async () => {
      const validId = '11111111-1111-4111-8111-111111111111';
      mockSupabaseQuery.single.mockResolvedValueOnce({ data: { id: validId }, error: null });
      mockSupabaseQuery.delete.mockReturnValue(mockSupabaseQuery);

      const req = createMcpRequest({
        method: 'tools/call',
        params: { name: 'delete_garment', arguments: { id: validId } },
        id: 14,
      });
      const res = await POST(req);
      const json = await res.json();

      expect(json.result.content[0].text).toContain(`Garment ID ${validId} has been permanently deleted`);
    });
  });

  describe('generate_outfit_visual', () => {
    it('returns pollinations lookbook URL', async () => {
      const req = createMcpRequest({
        method: 'tools/call',
        params: {
          name: 'generate_outfit_visual',
          arguments: { description: 'Navy blazer with khaki chinos' },
        },
        id: 15,
      });
      const res = await POST(req);
      const json = await res.json();

      expect(json.result.content[0].text).toContain('https://image.pollinations.ai/prompt/');
    });
  });
});
