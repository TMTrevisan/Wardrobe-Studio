import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';

export const POST = withUser(async ({ user, request }) => {
  const formData = await request.formData();
  const garmentId = formData.get('garmentId') as string | null;
  const file = formData.get('file') as File | null;

  if (!garmentId) return fail(400, 'No garment ID provided.');
  if (!file) return fail(400, 'No cutout image file provided.');

  // 0. Verify garment ownership.
  const { data: garment, error: ownErr } = await user.client
    .from('garments')
    .select('id')
    .eq('id', garmentId)
    .single();
  if (ownErr || !garment) return fail(404, 'Garment not found.');

  // 1. Fetch primary image record.
  const { data: primaryImage, error: fetchError } = await user.client
    .from('garment_images')
    .select('id')
    .eq('garment_id', garmentId)
    .eq('is_primary_profile', true)
    .maybeSingle();

  if (fetchError) return fail(500, fetchError.message);
  if (!primaryImage) {
    return fail(404, 'Primary garment image record not found. Add an image first.');
  }

  // 2. Upload cutout.
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const fileName = `processed/${garmentId}-${Date.now()}.png`;

  const { error: uploadError } = await user.client.storage
    .from('wardrobe-images')
    .upload(fileName, buffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (uploadError) return fail(500, `Storage upload failed: ${uploadError.message}`);

  const { data: { publicUrl } } = user.client.storage
    .from('wardrobe-images')
    .getPublicUrl(fileName);

  // 3. Insert cutout as a NEW image row (not overwriting the primary).
  //    The previous behaviour silently destroyed the raw wide-shot when
  //    background removal succeeded. Inserting as detail + auto-promoting
  //    keeps both shots accessible.
  const { data: newImage, error: insertError } = await user.client
    .from('garment_images')
    .insert({
      garment_id: garmentId,
      storage_path: publicUrl,
      is_primary_profile: true,
      asset_type: 'profile',
    })
    .select()
    .single();

  if (insertError) return fail(500, `Database insert failed: ${insertError.message}`);

  // 4. Demote any prior primary images so only one stays primary.
  await user.client
    .from('garment_images')
    .update({ is_primary_profile: false })
    .eq('garment_id', garmentId)
    .neq('id', newImage.id);

  return ok({ url: publicUrl });
});