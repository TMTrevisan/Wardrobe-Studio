import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { withUser, fail, ok } from '@/lib/api';
import { getDetectionPixelCrop, type NormalizedBoundingBox } from '@/lib/image/detection-preview';

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
    .eq('user_id', user.id);
  if (error) return fail(500, error.message);
  if (!detections?.length) {
    return fail(404, 'Those selected detections no longer exist. Return to the photo and run detection again.');
  }

  const created: Array<Record<string, unknown>> = [];
  const skipped: Array<{ detectionId: string; reason: string }> = [];
  const sourceCache = new Map<string, { input: Buffer; width: number; height: number }>();
  for (const detection of detections) {
    // Approval needs to be safe to retry. A prior request may have completed
    // the crop/database work but lost its client response while a later
    // catalog generation failed. Return that existing garment instead of
    // filtering it out and falsely reporting that no crops could be created.
    if (detection.review_status === 'approved' && detection.garment_id) {
      const { data: existingGarment, error: existingError } = await user.client
        .from('garments')
        .select('*')
        .eq('id', detection.garment_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (existingGarment) {
        created.push(existingGarment);
        continue;
      }
      skipped.push({ detectionId: detection.id, reason: existingError?.message || 'The previously approved garment is missing.' });
      continue;
    }
    if (detection.review_status !== 'pending') {
      skipped.push({ detectionId: detection.id, reason: `This detection is ${detection.review_status} and cannot be approved.` });
      continue;
    }
    const source = detection.source_assets;
    if (!source?.id || !source.storage_path) {
      skipped.push({ detectionId: detection.id, reason: 'The source photo is missing.' });
      continue;
    }
    let cached = sourceCache.get(source.id);
    if (!cached) {
      const { data: blob, error: downloadError } = await user.client.storage
        .from(source.bucket || 'wardrobe-sources')
        .download(source.storage_path);
      if (downloadError || !blob) {
        skipped.push({ detectionId: detection.id, reason: 'The source photo could not be downloaded.' });
        continue;
      }
      const input = Buffer.from(await blob.arrayBuffer());
      const metadata = await sharp(input).rotate().metadata();
      cached = { input, width: metadata.width || 1, height: metadata.height || 1 };
      sourceCache.set(source.id, cached);
    }
    const cropRegion = getDetectionPixelCrop(
      detection.bbox as NormalizedBoundingBox,
      cached.width,
      cached.height,
    );
    if (!cropRegion) {
      skipped.push({ detectionId: detection.id, reason: 'The detected crop was invalid.' });
      continue;
    }

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
    if (garmentError || !garment) {
      skipped.push({ detectionId: detection.id, reason: garmentError?.message || 'The garment record could not be created.' });
      continue;
    }

    const crop = await sharp(cached.input).rotate().extract(cropRegion)
      .resize(1400, 1400, { fit: 'contain', background: '#F5F0E8', withoutEnlargement: true })
      .jpeg({ quality: 95 }).toBuffer();
    const cropPath = `${user.id}/${garment.id}/${randomUUID()}-source.jpg`;
    const { error: uploadError } = await user.client.storage.from('wardrobe-catalog').upload(cropPath, crop, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (uploadError) {
      await user.client.from('garments').delete().eq('id', garment.id);
      skipped.push({ detectionId: detection.id, reason: uploadError.message });
      continue;
    }

    const { error: assetError } = await user.client.from('garment_assets').insert({
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
      });
    const { error: detectionError } = assetError ? { error: null } : await user.client
      .from('garment_detections').update({
        garment_id: garment.id,
        review_status: 'approved',
      }).eq('id', detection.id);
    if (assetError || detectionError) {
      await user.client.storage.from('wardrobe-catalog').remove([cropPath]);
      await user.client.from('garments').delete().eq('id', garment.id);
      skipped.push({ detectionId: detection.id, reason: assetError?.message || detectionError?.message || 'Approval could not be saved.' });
      continue;
    }
    created.push(garment);
  }

  if (!created.length) {
    console.error('Garment approval created no items', { userId: user.id, detectionIds, skipped });
    return fail(422, skipped[0]?.reason || 'No garment crops could be created.');
  }
  const uniqueItems = Array.from(new Map(created.map((item) => [item.id as string, item])).values());
  return ok({ items: uniqueItems, skipped });
});
