import { toFile } from 'openai';
import sharp from 'sharp';
import { withUser, fail, ok } from '@/lib/api';
import { buildCatalogPrompt, CATALOG_MODEL, CATALOG_QUALITY, CATALOG_SIZE, chooseChromaKey } from '@/lib/ai/catalog';
import { getOpenAI } from '@/lib/ai/openai';
import { removeChromaKey } from '@/lib/image/chroma';
import { toStorageFile } from '@/lib/image/upload-body';
import { getLegacyStorageLocation } from '@/lib/catalog-source';
import { logTelemetry } from '@/lib/telemetry';

export const maxDuration = 300;

type StoredImage = {
  id: string;
  storage_path: string;
  bucket?: string;
  mime_type?: string;
  kind?: string;
  is_primary_profile?: boolean;
};

// Pipeline stage IDs the drawer renders in its timeline. Keep in sync with
// GarmentDrawer.tsx PIPELINE_STEPS.
export const PIPELINE_STAGES = [
  'source_selected',
  'source_normalized',
  'gpt_image',
  'background_removed',
  'qa',
  'saved',
] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];

/**
 * Source crops can originate from older imports and different camera codecs.
 * Always decode and re-encode them before handing them to the image API so
 * EXIF orientation, color mode, and unusual JPEG metadata cannot invalidate a
 * paid generation request.
 */
async function normalizeCatalogSource(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: 'none', limitInputPixels: 30_000_000 })
    .rotate()
    .flatten({ background: '#f5f0e8' })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Catalog generation failed.';
}

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
    subcategory: garment.sub_category,
    brand: garment.brand,
    color: `${garment.color_family}${garment.hex_code ? ` (${garment.hex_code})` : ''}`,
    material: garment.fabric_type,
    fit: garment.fit_block,
    pattern: garment.pattern,
    formality: garment.formality,
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
      input: { sourceImageId: source.id, chromaKey, quality: CATALOG_QUALITY, size: CATALOG_SIZE },
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (jobError) return fail(500, `Create the Wardrobe Studio migration first: ${jobError.message}`);

  await user.client.from('garments').update({ catalog_status: 'generating' }).eq('id', garmentId);

  // Track the most recent pipeline stage for the response and persisted job.
  let currentStage: PipelineStage = 'source_selected';
  const setStage = async (next: PipelineStage, progress: number, extra?: Record<string, unknown>) => {
    currentStage = next;
    await user.client
      .from('processing_jobs')
      .update({
        progress,
        output: { stage: next, ...(extra || {}) },
      })
      .eq('id', job.id);
  };

  try {
    let sourceBuffer: Buffer;
    let sourceMime = source.mime_type || 'image/jpeg';
    if (source.bucket) {
      const { data: blob, error: downloadError } = await user.client.storage
        .from(source.bucket).download(source.storage_path);
      if (downloadError || !blob) throw downloadError || new Error('Could not read the source image.');
      sourceBuffer = Buffer.from(await blob.arrayBuffer());
      sourceMime = blob.type || sourceMime;
    } else if (supabaseUrl && getLegacyStorageLocation(source.storage_path, supabaseUrl)) {
      const location = getLegacyStorageLocation(source.storage_path, supabaseUrl)!;
      const { data: blob, error: downloadError } = await user.client.storage
        .from(location.bucket).download(location.path);
      if (downloadError || !blob) throw downloadError || new Error('Could not read the source image.');
      sourceBuffer = Buffer.from(await blob.arrayBuffer());
      sourceMime = blob.type || sourceMime;
    } else {
      const sourceResponse = await fetch(source.storage_path, { signal: AbortSignal.timeout(30_000) });
      if (!sourceResponse.ok) throw new Error('Could not read the source image.');
      sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
      sourceMime = sourceResponse.headers.get('content-type') || sourceMime;
    }

    await setStage('source_normalized', 30);
    const normalizedSource = await normalizeCatalogSource(sourceBuffer);

    await setStage('gpt_image', 60);
    const openai = getOpenAI();
    const generated = await openai.images.edit({
      model: CATALOG_MODEL,
      image: await toFile(normalizedSource, 'garment-reference.jpg', { type: 'image/jpeg' }),
      prompt,
      size: CATALOG_SIZE,
      quality: CATALOG_QUALITY,
      background: 'opaque',
    });
    const base64 = generated.data?.[0]?.b64_json;
    if (!base64) throw new Error('GPT Image returned no image data.');

    await setStage('background_removed', 80);
    const chromaPng = Buffer.from(base64, 'base64');
    const cutout = await removeChromaKey(chromaPng, chromaKey);
    const qaStatus = cutout.cornersTransparent && cutout.visibleRatio > 0.03 && cutout.visibleRatio < 0.85
      ? 'passed'
      : 'needs_review';

    await setStage('qa', 90, { qaStatus, visibleRatio: cutout.visibleRatio });

    const stamp = Date.now();
    const chromaPath = `${user.id}/${garmentId}/${stamp}-chroma.png`;
    const cutoutPath = `${user.id}/${garmentId}/${stamp}-cutout.png`;
    const bucket = user.client.storage.from('wardrobe-catalog');
    const [chromaUpload, cutoutUpload] = await Promise.all([
      bucket.upload(chromaPath, toStorageFile(chromaPng, 'catalog-chroma.png', 'image/png'), { contentType: 'image/png', upsert: false }),
      bucket.upload(cutoutPath, toStorageFile(cutout.png, 'catalog-cutout.png', 'image/png'), { contentType: 'image/png', upsert: false }),
    ]);
    if (chromaUpload.error) throw new Error(`Catalog chroma upload failed: ${chromaUpload.error.message}`);
    if (cutoutUpload.error) throw new Error(`Catalog cutout upload failed: ${cutoutUpload.error.message}`);

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
        is_primary: false,
        qa_status: 'pending',
        qa_json: {},
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
    if (assetError) throw new Error(`Catalog asset record failed: ${assetError.message}`);

    const { data: signed } = await bucket.createSignedUrl(cutoutPath, 60 * 60);
    await setStage('saved', 100, { cutoutPath, chromaPath, qaStatus });
    await Promise.all([
      user.client.from('garments').update({ catalog_status: qaStatus === 'passed' ? 'ready' : 'needs_review' }).eq('id', garmentId),
      user.client.from('processing_jobs').update({
        status: 'succeeded',
        finished_at: new Date().toISOString(),
      }).eq('id', job.id),
    ]);

    await logTelemetry(
      'OpenAI_Image_Edit',
      0,
      0,
      {
        imageEdit: { quality: CATALOG_QUALITY, size: CATALOG_SIZE },
        model: CATALOG_MODEL,
        jobId: job.id,
        garmentId,
        qaStatus,
        outcome: 'succeeded',
      },
      { client: user.client, userId: user.id }
    );

    return ok({
      jobId: job.id,
      url: signed?.signedUrl,
      qaStatus,
      chromaKey,
      stage: currentStage,
    });
  } catch (catalogError: unknown) {
    const message = errorMessage(catalogError);
    console.error('Catalog generation failed', {
      jobId: job.id,
      garmentId,
      sourceId: source.id,
      sourceBucket: source.bucket,
      sourceMime: source.mime_type || 'image/jpeg',
      stage: currentStage,
      message,
    });
    await Promise.all([
      user.client.from('garments').update({ catalog_status: 'failed' }).eq('id', garmentId),
      user.client.from('processing_jobs').update({
        status: 'failed',
        output: { stage: currentStage },
        error_message: message,
        finished_at: new Date().toISOString(),
      }).eq('id', job.id),
    ]);

    // Log a zero-cost row for failed calls so the spend ledger still reflects
    // the attempt and any future billing quota can be cross-checked.
    await logTelemetry(
      'OpenAI_Image_Edit',
      0,
      0,
      {
        imageEdit: { quality: CATALOG_QUALITY, size: CATALOG_SIZE },
        model: CATALOG_MODEL,
        jobId: job.id,
        garmentId,
        outcome: 'failed',
        stage: currentStage,
        error: message,
      },
      { client: user.client, userId: user.id }
    );

    if (/billing hard limit|insufficient quota|billing.*limit/i.test(message)) {
      return fail(402, 'OpenAI API billing limit reached. Add API credit or raise your usage limit, then retry this garment.', { stage: currentStage, jobId: job.id });
    }
    return fail(502, message, { stage: currentStage, jobId: job.id });
  }
});
