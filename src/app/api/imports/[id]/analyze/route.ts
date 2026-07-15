import { withUser, fail, ok } from '@/lib/api';
import { GEMINI_VISION_MODEL, getGemini } from '@/lib/ai/gemini';
import sharp from 'sharp';

const analysisSchema = {
  type: 'object',
  properties: {
    contains_person: { type: 'boolean' },
    garments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Tailoring', 'Accessories', 'Dresses'] },
          sub_category: { type: 'string' },
          description: { type: 'string' },
          primary_color: { type: 'string' },
          hex_code: { type: 'string' },
          material: { type: 'string' },
          visible_details: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          bbox: {
            type: 'object',
            properties: {
              left: { type: 'number' }, top: { type: 'number' },
              right: { type: 'number' }, bottom: { type: 'number' },
            },
            required: ['left', 'top', 'right', 'bottom'],
          },
        },
        required: ['category', 'sub_category', 'description', 'primary_color', 'confidence', 'bbox'],
      },
    },
  },
  required: ['contains_person', 'garments'],
} as const;

export const maxDuration = 300;

type GeminiGarment = {
  category: string;
  sub_category: string;
  description: string;
  primary_color: string;
  hex_code?: string;
  material?: string;
  visible_details?: string[];
  confidence?: number;
  bbox: { left: number; top: number; right: number; bottom: number };
};

type GeminiAnalysis = { contains_person: boolean; garments: GeminiGarment[] };

export const POST = withUser(async ({ user, request }) => {
  const { id } = await request.json().catch(() => ({ id: null }));
  const importId = id || request.url.split('/').slice(-2)[0];
  if (!importId) return fail(400, 'Import ID is required.');

  const { data: importRow } = await user.client
    .from('wardrobe_imports').select('*').eq('id', importId).eq('user_id', user.id).single();
  if (!importRow) return fail(404, 'Import not found.');

  const { data: assets, error } = await user.client
    .from('source_assets')
    .select('*')
    .eq('import_id', importId)
    .eq('user_id', user.id)
    .in('status', ['uploaded', 'queued'])
    .limit(12);
  if (error) return fail(500, error.message);
  if (!assets?.length) return fail(400, 'No unprocessed photos remain in this import.');

  await user.client.from('wardrobe_imports').update({ status: 'scanning' }).eq('id', importId);
  const gemini = getGemini();
  const detections: Array<Record<string, unknown>> = [];

  for (const asset of assets) {
    await user.client.from('source_assets').update({ status: 'analyzing' }).eq('id', asset.id);
    try {
      const { data: blob, error: downloadError } = await user.client.storage
        .from(asset.bucket || 'wardrobe-sources')
        .download(asset.storage_path);
      if (downloadError || !blob) throw downloadError || new Error('Photo download failed.');
      const buffer = Buffer.from(await blob.arrayBuffer());
      const metadata = await sharp(buffer).rotate().metadata();
      const sourceWidth = metadata.width || asset.width || 1;
      const sourceHeight = metadata.height || asset.height || 1;
      const response = await gemini.models.generateContent({
        model: GEMINI_VISION_MODEL,
        contents: [
          { inlineData: { data: buffer.toString('base64'), mimeType: asset.mime_type } },
          { text: `Inventory every deliberately worn clothing item in this photo. Include visible layers,
footwear, belts, ties, hats, and bags. Exclude skin, props, furniture, and uncertain fragments.
Return normalized bounding boxes from 0 to 1. Describe only source-supported details.
Do not treat two layers as one garment.` },
        ],
        config: { responseMimeType: 'application/json', responseSchema: analysisSchema as never },
      });
      const parsed = JSON.parse(response.text || '{"contains_person":false,"garments":[]}') as GeminiAnalysis;
      const rows = (parsed.garments || []).map((garment) => ({
        user_id: user.id,
        source_asset_id: asset.id,
        category: garment.category,
        sub_category: garment.sub_category,
        description: garment.description,
        bbox: garment.bbox,
        confidence: Math.max(0, Math.min(1, garment.confidence || 0.5)),
        colors: [{ name: garment.primary_color, hex: garment.hex_code }],
        observed_details: { material: garment.material, details: garment.visible_details || [] },
        candidate_group_key: `${garment.category}:${garment.sub_category}:${garment.primary_color}`.toLowerCase(),
      }));
      if (rows.length) {
        const { data: inserted, error: insertError } = await user.client
          .from('garment_detections').insert(rows).select();
        if (insertError) throw insertError;
        const { data: signed } = await user.client.storage
          .from(asset.bucket || 'wardrobe-sources')
          .createSignedUrl(asset.storage_path, 60 * 60);
        detections.push(...(inserted || []).map((detection) => ({
          ...detection,
          source_preview_url: signed?.signedUrl || null,
          source_width: sourceWidth,
          source_height: sourceHeight,
          source_filename: asset.original_filename,
        })));
      }
      await user.client.from('source_assets').update({
        status: 'analyzed',
        analysis_json: parsed,
        width: sourceWidth,
        height: sourceHeight,
      }).eq('id', asset.id);
    } catch (assetError: unknown) {
      const message = assetError instanceof Error ? assetError.message : 'Photo analysis failed.';
      await user.client.from('source_assets').update({ status: 'failed', analysis_json: { error: message } }).eq('id', asset.id);
    }
  }

  const processedAssets = (importRow.processed_assets || 0) + assets.length;
  await user.client.from('wardrobe_imports').update({
    status: 'review',
    processed_assets: processedAssets,
    detected_items: (importRow.detected_items || 0) + detections.length,
    updated_at: new Date().toISOString(),
  }).eq('id', importId);

  return ok({ importId, detections, processedAssets });
});
