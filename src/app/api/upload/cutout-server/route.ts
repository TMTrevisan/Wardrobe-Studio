import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';
import { logTelemetry } from '@/lib/telemetry';

export const POST = withUser(async ({ user, request }) => {
  const { garmentId, storagePath } = await request.json();

  if (!garmentId || !storagePath) return fail(400, 'Missing garmentId or storagePath.');

  // 0. Verify ownership.
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
  if (!primaryImage) return fail(404, 'Primary garment image record not found.');

  let processedImageUrl: string | null = null;
  const removeBgApiKey = process.env.REMOVE_BG_API_KEY || '';
  const localRemoverUrl = process.env.BACKGROUND_REMOVER_URL || '';

  // Attempt 1: Remove.bg API
  if (removeBgApiKey) {
    try {
      const removeBgFormData = new FormData();
      removeBgFormData.append('image_url', storagePath);
      removeBgFormData.append('size', 'auto');

      const removeBgRes = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': removeBgApiKey },
        body: removeBgFormData,
        signal: AbortSignal.timeout(30_000),
      });

      if (removeBgRes.ok) {
        const cutoutBlob = await removeBgRes.blob();
        const cutoutBuffer = Buffer.from(await cutoutBlob.arrayBuffer());
        const cutoutFileName = `processed/${garmentId}-${Date.now()}.png`;

        const { error: cutoutError } = await user.client.storage
          .from('wardrobe-images')
          .upload(cutoutFileName, cutoutBuffer, {
            contentType: 'image/png',
            upsert: true,
          });

        if (!cutoutError) {
          const { data: { publicUrl } } = user.client.storage
            .from('wardrobe-images')
            .getPublicUrl(cutoutFileName);
          processedImageUrl = publicUrl;
        }
      }
    } catch (err) {
      console.error('Server cutout: Remove.bg failed:', err);
    }
  }

  // Attempt 2: Hugging Face Serverless Inference API (briaai/RMBG-1.4)
  if (!processedImageUrl && process.env.HF_TOKEN) {
    try {
      const imageResponse = await fetch(storagePath, { signal: AbortSignal.timeout(15_000) });
      if (imageResponse.ok) {
        const imageBlob = await imageResponse.blob();
        const buffer = Buffer.from(await imageBlob.arrayBuffer());

        const hfRes = await fetch('https://api-inference.huggingface.co/models/briaai/RMBG-1.4', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.HF_TOKEN}`,
            'Content-Type': 'application/octet-stream',
          },
          body: buffer,
          signal: AbortSignal.timeout(60_000),
        });

        if (hfRes.ok) {
          const cutoutBuffer = Buffer.from(await hfRes.arrayBuffer());
          const cutoutFileName = `processed/${garmentId}-${Date.now()}.png`;

          const { error: cutoutError } = await user.client.storage
            .from('wardrobe-images')
            .upload(cutoutFileName, cutoutBuffer, {
              contentType: 'image/png',
              upsert: true,
            });

          if (!cutoutError) {
            const { data: { publicUrl } } = user.client.storage
              .from('wardrobe-images')
              .getPublicUrl(cutoutFileName);
            processedImageUrl = publicUrl;
          }
        }
      }
    } catch (err) {
      console.error('Server cutout: HF Inference failed:', err);
    }
  }

  // Attempt 3: Local Python script fallback — only enabled when the
  // operator explicitly opts in. Serverless deployments won't have
  // python3 on PATH, so we never try this in production by default.
  if (!processedImageUrl && process.env.BG_REMOVAL_LOCAL_ENABLED === 'true' && localRemoverUrl) {
    try {
      const imageResponse = await fetch(storagePath, { signal: AbortSignal.timeout(15_000) });
      if (imageResponse.ok) {
        const imageBlob = await imageResponse.blob();
        const buffer = Buffer.from(await imageBlob.arrayBuffer());

        const fs = await import('node:fs');
        const path = await import('node:path');
        const { execSync } = await import('node:child_process');

        const tempDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const tempIn = path.join(tempDir, `in-${garmentId}.jpg`);
        const tempOut = path.join(tempDir, `out-${garmentId}.png`);

        fs.writeFileSync(tempIn, buffer);

        const pyScript = path.join(process.cwd(), 'scripts', 'remove_bg.py');

        let pyBin = 'python3';
        try {
          execSync('which python3', { stdio: 'ignore' });
        } catch {
          pyBin = '/Library/Frameworks/Python.framework/Versions/3.13/bin/python3';
        }

        const cmd = `"${pyBin}" "${pyScript}" "${tempIn}" "${tempOut}"`;
        try {
          execSync(cmd, { stdio: 'pipe' });
        } catch (execErr: any) {
          console.error('Python process failed with output:', execErr.stdout?.toString(), execErr.stderr?.toString());
          throw execErr;
        }

        if (fs.existsSync(tempOut)) {
          const cutoutBuffer = fs.readFileSync(tempOut);
          const cutoutFileName = `processed/${garmentId}-${Date.now()}.png`;

          const { error: cutoutError } = await user.client.storage
            .from('wardrobe-images')
            .upload(cutoutFileName, cutoutBuffer, {
              contentType: 'image/png',
              upsert: true,
            });

          if (!cutoutError) {
            const { data: { publicUrl } } = user.client.storage
              .from('wardrobe-images')
              .getPublicUrl(cutoutFileName);
            processedImageUrl = publicUrl;
          }
        }

        if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
        if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
      }
    } catch (err: any) {
      console.error('Server cutout: Python fallback failed:', err.message || err);
    }
  }

  if (!processedImageUrl) {
    return fail(500, 'Background removal failed on the server. Configure REMOVE_BG_API_KEY or HF_TOKEN.');
  }

  // Insert cutout as a new image row (don't overwrite the original primary).
  const { data: newImage, error: insertError } = await user.client
    .from('garment_images')
    .insert({
      garment_id: garmentId,
      storage_path: processedImageUrl,
      is_primary_profile: true,
      asset_type: 'profile',
    })
    .select()
    .single();

  if (insertError) return fail(500, `Database insert failed: ${insertError.message}`);

  await user.client
    .from('garment_images')
    .update({ is_primary_profile: false })
    .eq('garment_id', garmentId)
    .neq('id', newImage.id);

  return ok({ url: processedImageUrl });
});