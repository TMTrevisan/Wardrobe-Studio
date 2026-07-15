import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { withUser, fail, ok } from '@/lib/api';

function tonalValue(hex?: string): 'Light' | 'Medium' | 'Dark' {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return 'Medium';
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 180 ? 'Light' : luminance < 85 ? 'Dark' : 'Medium';
}

export const POST = withUser(async ({ user, request }) => {
  const { detectionIds } = await request.json();
  if (!Array.isArray(detectionIds) || !detectionIds.length) return fail(400, 'Choose at least one detected garment.');

  const { data: detections, error } = await user.client
    .from('garment_detections')
    .select('*, source_assets(*)')
    .in('id', detectionIds)
    .eq('user_id', user.id)
    .eq('review_status', 'pending');
  if (error) return fail(500, error.message);

  const created: Array<Record<string, unknown>> = [];
  for (const detection of detections || []) {
    const source = detection.source_assets;
    const { data: blob, error: downloadError } = await user.client.storage
      .from(source.bucket || 'wardrobe-sources')
      .download(source.storage_path);
    if (downloadError || !blob) continue;

    const input = Buffer.from(await blob.arrayBuffer());
    const metadata = await sharp(input).rotate().metadata();
    const width = metadata.width || 1;
    const height = metadata.height || 1;
    const bbox = detection.bbox || {};
    const paddingX = (Number(bbox.right) - Number(bbox.left)) * 0.12;
    const paddingY = (Number(bbox.bottom) - Number(bbox.top)) * 0.12;
    const left = Math.max(0, Math.floor((Number(bbox.left) - paddingX) * width));
    const top = Math.max(0, Math.floor((Number(bbox.top) - paddingY) * height));
    const right = Math.min(width, Math.ceil((Number(bbox.right) + paddingX) * width));
    const bottom = Math.min(height, Math.ceil((Number(bbox.bottom) + paddingY) * height));
    if (right <= left || bottom <= top) continue;

    const colors = Array.isArray(detection.colors) ? detection.colors : [];
    const primaryColor = colors[0] || {};
    const material = detection.observed_details?.material || 'Unknown';
    const { data: garment, error: garmentError } = await user.client.from('garments').insert({
      user_id: user.id,
      category: detection.category,
      sub_category: detection.sub_category || detection.category,
      display_name: detection.description || detection.sub_category,
      brand: null,
      color_family: primaryColor.name || 'Unknown',
      hex_code: /^#[0-9a-f]{6}$/i.test(primaryColor.hex || '') ? primaryColor.hex : null,
      tonal_value: tonalValue(primaryColor.hex),
      fabric_type: material,
      fit_block: 'Unknown',
      style_detail: detection.description,
      status: 'Active',
      catalog_status: 'not_started',
      metadata_confidence: detection.confidence,
      ai_extracted_json: detection,
    }).select().single();
    if (garmentError || !garment) continue;

    const crop = await sharp(input).rotate().extract({
      left,
      top,
      width: right - left,
      height: bottom - top,
    }).resize(1400, 1400, { fit: 'contain', background: '#F5F0E8', withoutEnlargement: true })
      .jpeg({ quality: 95 }).toBuffer();
    const cropPath = `${user.id}/${garment.id}/${randomUUID()}-source.jpg`;
    const { error: uploadError } = await user.client.storage.from('wardrobe-catalog').upload(cropPath, crop, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (uploadError) {
      await user.client.from('garments').delete().eq('id', garment.id);
      continue;
    }

    await Promise.all([
      user.client.from('garment_assets').insert({
        user_id: user.id,
        garment_id: garment.id,
        source_asset_id: source.id,
        kind: 'source_crop',
        bucket: 'wardrobe-catalog',
        storage_path: cropPath,
        mime_type: 'image/jpeg',
        width: 1400,
        height: 1400,
        is_primary: true,
        qa_status: 'pending',
      }),
      user.client.from('garment_detections').update({
        garment_id: garment.id,
        review_status: 'approved',
      }).eq('id', detection.id),
    ]);
    created.push(garment);
  }

  return ok({ items: created });
});
