import { toFile } from 'openai';
import { withUser, fail, ok } from '@/lib/api';
import { buildCatalogPrompt, CATALOG_MODEL, CATALOG_QUALITY, chooseChromaKey } from '@/lib/ai/catalog';
import { getOpenAI } from '@/lib/ai/openai';
import { removeChromaKey } from '@/lib/image/chroma';

export const maxDuration = 300;

type StoredImage = {
  id: string;
  storage_path: string;
  bucket?: string;
  mime_type?: string;
  kind?: string;
  is_primary_profile?: boolean;
};

export const POST = withUser(async ({ user, request }) => {
  const { garmentId } = await request.json();
  if (!garmentId) return fail(400, 'garmentId is required.');

  const { data: garment, error } = await user.client
    .from('garments')
    .select('*, garment_images(*), garment_assets(*)')
    .eq('id', garmentId)
    .eq('user_id', user.id)
    .single();
  if (error || !garment) return fail(404, 'Garment not found.');

  const assets = (garment.garment_assets || []) as StoredImage[];
  const images = (garment.garment_images || []) as StoredImage[];
  const source = assets.find((asset) => asset.kind === 'source_crop')
    || images.find((image) => image.is_primary_profile)
    || images[0];
  if (!source?.storage_path) return fail(400, 'Add a source image before generating a catalog image.');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (!source.bucket && supabaseUrl && !source.storage_path.startsWith(supabaseUrl)) {
    return fail(400, 'Source image must come from this wardrobe storage project.');
  }

  const chromaKey = chooseChromaKey([garment.hex_code]);
  const name = garment.display_name || `${garment.brand || ''} ${garment.sub_category}`.trim();
  const prompt = buildCatalogPrompt({
    name,
    category: garment.category,
    color: `${garment.color_family}${garment.hex_code ? ` (${garment.hex_code})` : ''}`,
    material: garment.fabric_type,
    details: garment.style_detail,
    chromaKey,
  });

  const { data: job, error: jobError } = await user.client
    .from('processing_jobs')
    .insert({
      user_id: user.id,
      garment_id: garmentId,
      job_type: 'generate_catalog',
      status: 'running',
      progress: 10,
      model: CATALOG_MODEL,
      input: { sourceImageId: source.id, chromaKey, quality: CATALOG_QUALITY },
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (jobError) return fail(500, `Create the Wardrobe Studio migration first: ${jobError.message}`);

  await user.client.from('garments').update({ catalog_status: 'generating' }).eq('id', garmentId);

  try {
    let sourceBuffer: Buffer;
    let sourceMime = source.mime_type || 'image/jpeg';
    if (source.bucket) {
      const { data: blob, error: downloadError } = await user.client.storage
        .from(source.bucket).download(source.storage_path);
      if (downloadError || !blob) throw downloadError || new Error('Could not read the source image.');
      sourceBuffer = Buffer.from(await blob.arrayBuffer());
      sourceMime = blob.type || sourceMime;
    } else {
      const sourceResponse = await fetch(source.storage_path, { signal: AbortSignal.timeout(30_000) });
      if (!sourceResponse.ok) throw new Error('Could not read the source image.');
      sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
      sourceMime = sourceResponse.headers.get('content-type') || sourceMime;
    }

    const openai = getOpenAI();
    const generated = await openai.images.edit({
      model: CATALOG_MODEL,
      image: await toFile(sourceBuffer, 'garment-reference.jpg', { type: sourceMime }),
      prompt,
      size: '1024x1024',
      quality: CATALOG_QUALITY,
      background: 'opaque',
    });
    const base64 = generated.data?.[0]?.b64_json;
    if (!base64) throw new Error('GPT Image returned no image data.');

    await user.client.from('processing_jobs').update({ progress: 70 }).eq('id', job.id);
    const chromaPng = Buffer.from(base64, 'base64');
    const cutout = await removeChromaKey(chromaPng, chromaKey);
    const qaStatus = cutout.cornersTransparent && cutout.visibleRatio > 0.03 && cutout.visibleRatio < 0.85
      ? 'passed'
      : 'needs_review';

    const stamp = Date.now();
    const chromaPath = `${user.id}/${garmentId}/${stamp}-chroma.png`;
    const cutoutPath = `${user.id}/${garmentId}/${stamp}-cutout.png`;
    const bucket = user.client.storage.from('wardrobe-catalog');
    const [chromaUpload, cutoutUpload] = await Promise.all([
      bucket.upload(chromaPath, chromaPng, { contentType: 'image/png', upsert: false }),
      bucket.upload(cutoutPath, cutout.png, { contentType: 'image/png', upsert: false }),
    ]);
    if (chromaUpload.error) throw chromaUpload.error;
    if (cutoutUpload.error) throw cutoutUpload.error;

    await user.client
      .from('garment_assets')
      .update({ is_primary: false })
      .eq('garment_id', garmentId)
      .eq('kind', 'catalog_cutout');

    const { error: assetError } = await user.client.from('garment_assets').insert([
      {
        user_id: user.id,
        garment_id: garmentId,
        kind: 'catalog_chroma',
        bucket: 'wardrobe-catalog',
        storage_path: chromaPath,
        chroma_key: chromaKey,
        prompt,
        model: CATALOG_MODEL,
        qa_status: 'pending',
      },
      {
        user_id: user.id,
        garment_id: garmentId,
        kind: 'catalog_cutout',
        bucket: 'wardrobe-catalog',
        storage_path: cutoutPath,
        chroma_key: chromaKey,
        prompt,
        model: CATALOG_MODEL,
        width: cutout.width,
        height: cutout.height,
        is_primary: true,
        qa_status: qaStatus,
        qa_json: {
          cornersTransparent: cutout.cornersTransparent,
          visibleRatio: cutout.visibleRatio,
        },
      },
    ]);
    if (assetError) throw assetError;

    const { data: signed } = await bucket.createSignedUrl(cutoutPath, 60 * 60);
    await Promise.all([
      user.client.from('garments').update({ catalog_status: qaStatus === 'passed' ? 'ready' : 'needs_review' }).eq('id', garmentId),
      user.client.from('processing_jobs').update({
        status: 'succeeded',
        progress: 100,
        output: { cutoutPath, chromaPath, qaStatus },
        finished_at: new Date().toISOString(),
      }).eq('id', job.id),
    ]);

    return ok({
      jobId: job.id,
      url: signed?.signedUrl,
      qaStatus,
      chromaKey,
    });
  } catch (catalogError: unknown) {
    const message = catalogError instanceof Error ? catalogError.message : 'Catalog generation failed.';
    await Promise.all([
      user.client.from('garments').update({ catalog_status: 'failed' }).eq('id', garmentId),
      user.client.from('processing_jobs').update({
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
      }).eq('id', job.id),
    ]);
    return fail(502, message);
  }
});
