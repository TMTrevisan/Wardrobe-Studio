import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';
import { assertPublicHttpsUrl } from '@/lib/url-safety';

export const POST = withUser(async ({ user, request }) => {
  let garmentId: string | null = null;
  let buffer: Buffer | null = null;
  let contentType = 'image/jpeg';
  let fileExtension = 'jpg';

  const reqContentType = request.headers.get('content-type') || '';

  if (reqContentType.includes('application/json')) {
    const body = await request.json();
    garmentId = body.garmentId;
    const imageUrl = body.imageUrl;

    if (!garmentId || !imageUrl) {
      return fail(400, 'Missing garmentId or imageUrl.');
    }

    // SSRF guard: refuse private/loopback hosts before issuing the fetch.
    try {
      await assertPublicHttpsUrl(imageUrl);
    } catch (err: any) {
      return fail(400, `Refused image URL: ${err.message}`);
    }

    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept': 'image/jpeg,image/png,image/webp,image/*;q=0.8'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });

    if (!imageResponse.ok) {
      return fail(400, `Failed to download image: Status ${imageResponse.status}`);
    }

    contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const blob = await imageResponse.blob();
    buffer = Buffer.from(await blob.arrayBuffer());
    fileExtension = contentType.split('/').pop() || 'jpg';
  } else {
    const formData = await request.formData();
    garmentId = formData.get('garmentId') as string | null;
    const file = formData.get('file') as File | null;

    if (!garmentId) return fail(400, 'Missing garmentId.');
    if (!file) return fail(400, 'Missing file.');

    const bytes = await file.arrayBuffer();
    buffer = Buffer.from(bytes);

    if (!file.type.startsWith('image/')) {
      return fail(400, 'Security Violation: File is not an image.');
    }

    contentType = file.type;
    fileExtension = (file.name.split('.').pop() || 'jpg').toLowerCase();
  }

  // 0. Verify garment ownership.
  const { data: garment, error: ownErr } = await user.client
    .from('garments')
    .select('id')
    .eq('id', garmentId)
    .single();
  if (ownErr || !garment) return fail(404, 'Garment not found.');

  const fileName = `${garmentId}-add-${Date.now()}.${fileExtension}`;
  const filePath = `raw/${fileName}`;

  // 1. Upload to Supabase Storage.
  const { error: uploadError } = await user.client.storage
    .from('wardrobe-images')
    .upload(filePath, buffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) return fail(500, `Storage upload failed: ${uploadError.message}`);

  const { data: { publicUrl } } = user.client.storage
    .from('wardrobe-images')
    .getPublicUrl(filePath);

  // 2. Register in garment_images.
  const { data: imgRecord, error: imgError } = await user.client
    .from('garment_images')
    .insert([
      {
        garment_id: garmentId,
        storage_path: publicUrl,
        is_primary_profile: false,
        asset_type: 'detail',
      },
    ])
    .select()
    .single();

  if (imgError) return fail(500, `Database insertion failed: ${imgError.message}`);

  const { data: updatedImages } = await user.client
    .from('garment_images')
    .select('*')
    .eq('garment_id', garmentId);

  return ok({ image: imgRecord, images: updatedImages });
});