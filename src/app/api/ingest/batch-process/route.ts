import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';
import { logTelemetry } from '@/lib/telemetry';
import { limit, withRetry } from '@/lib/concurrency';

const geminiApiKey = process.env.GEMINI_API_KEY || '';
const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

export const POST = withUser(async ({ user, request }) => {
  if (!ai) {
    return fail(500, 'GEMINI_API_KEY is not configured.');
  }

  const { ids } = await request.json();
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return fail(400, 'No garment IDs provided.');
  }

  // Each worker is responsible for its own try/catch — it returns a result
  // object even on failure. Bound concurrency so a 20-item batch doesn't
  // trip Flash-Lite's 60 RPM rate limit.
  async function processOne(id: string) {
    try {
      // 1. Fetch the garment owned by THIS user, joined with its images.
      const { data: garment, error: fetchError } = await user.client
        .from('garments')
        .select('*, garment_images(*)')
        .eq('id', id)
        .eq('user_id', user.id) // RLS should enforce this, but be explicit
        .single();

      if (fetchError || !garment) {
        throw new Error(`Garment not found: ${fetchError?.message || 'empty row'}`);
      }

      const imagesList = garment.garment_images || [];
      if (imagesList.length === 0) {
        throw new Error(`No images registered for garment ${id}.`);
      }
      console.log(
        `[batch-process] garment ${id}: sending ${imagesList.length} image(s) to Gemini`,
        imagesList.map((i: any) => i.asset_type || 'unknown')
      );

      // 2. Fetch all images into base64 (concurrently).
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const imageParts = await Promise.all(
        imagesList.map(async (img: any) => {
          // The image URLs are written by our own upload route, so they
          // should always live in our Supabase storage. Belt-and-suspenders
          // check: only allow our own host. This blocks a tampered DB row
          // from making the server fetch arbitrary URLs and pipe them into
          // Gemini (and exfiltrate via prompt-injection in the response).
          if (supabaseUrl && !img.storage_path.startsWith(supabaseUrl)) {
            throw new Error('Security Violation: image storage domain mismatch.');
          }
          const imageResponse = await fetch(img.storage_path, {
            signal: AbortSignal.timeout(15_000),
          });
          if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image: ${img.storage_path}`);
          }
          const buf = Buffer.from(await (await imageResponse.blob()).arrayBuffer());
          return {
            inlineData: {
              data: buf.toString('base64'),
              mimeType: imageResponse.headers.get('content-type') || 'image/jpeg',
            },
          };
        })
      );

      // 3. Gemini call with retry on 429 / 5xx.
      const promptText = `
        You are an expert fashion stylist. You are given multiple images of the same garment.
        - Evaluate the wide-angle profile shot(s) to determine the category, color, silhouette, fabric texture, and fit.
        - Evaluate close-up details or clothing laundry tags to extract the exact brand name, sizing, and specific fabric content percentages.

        Classify the item under these rules:
        - Category: Must be exactly one of: 'Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Tailoring'.
        - Sub-Category: Specify the clothing sub-type (e.g., T-Shirt, Chinos, Shorts, Chelsea Boots, Bomber Jacket, Blazer, Sneaker, Oxford). Use 'Shorts' for short pants, and include sleeve length details ('Short Sleeve T-Shirt', 'Long Sleeve Shirt', 'Outer Layer Jacket') if categorizing tops.
        - Style Detail: Write a precise style description specifying style characteristics, fit traits, and cuts. For shoes, always specify the height cut ('Low-Top', 'High-Top', 'Mid-Top') or closure style. For tops/outerwear, include neck/collar lines, pocket placements, and cuffs. Be as detailed as possible to make this highly descriptive for styling algorithms.
        - Color Family: The dominant color name.
        - Hex Code: Nearest hex code swatch representing the color, e.g. #002060.
        - Tonal Value: Must be exactly one of: 'Light', 'Medium', 'Dark'.
        - Fabric Type: e.g. Cotton, Linen, Denim, Wool, Silk. Extract exact percentages/composition if visible on tags (e.g., 70% Wool, 30% Cashmere or 100% Linen).
        - Fit Block: e.g. Slim, Regular, Relaxed, Tailored.
        - Brand: The visible brand (or "Unknown").

        Additional context note from user:
        "${garment.notes || 'None'}"
      `;

      const response = await withRetry(
        () =>
          ai!.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: [...imageParts, { text: promptText }],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'object',
                properties: {
                  category: { type: 'string', enum: ['Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Tailoring'] },
                  sub_category: { type: 'string' },
                  style_detail: { type: 'string' },
                  brand: { type: 'string' },
                  color_family: { type: 'string' },
                  hex_code: { type: 'string' },
                  tonal_value: { type: 'string', enum: ['Light', 'Medium', 'Dark'] },
                  fabric_type: { type: 'string' },
                  fit_block: { type: 'string' },
                },
                required: ['category', 'sub_category', 'style_detail', 'color_family', 'hex_code', 'tonal_value', 'fabric_type', 'fit_block'],
              },
            },
          }),
        { attempts: 3, baseDelayMs: 800 }
      );

      const responseText = response.text;
      if (!responseText) throw new Error('Empty response from Gemini.');

      const parsed = JSON.parse(responseText);

      // 4. Background removal (optional; failure is non-fatal).
      const primaryImage = imagesList.find((img: any) => img.is_primary_profile) || imagesList[0];
      let processedImageUrl = primaryImage.storage_path;

      if (process.env.REMOVE_BG_API_KEY) {
        processedImageUrl =
          (await tryRemoveBg(user.client, id, primaryImage.storage_path)) || processedImageUrl;
      }
      if (processedImageUrl === primaryImage.storage_path && process.env.HF_TOKEN) {
        processedImageUrl =
          (await tryHFRemoveBg(user.client, id, primaryImage.storage_path)) || processedImageUrl;
      }
      // Local Python is opt-in only — never runs in serverless by default.
      if (
        processedImageUrl === primaryImage.storage_path &&
        process.env.BG_REMOVAL_LOCAL_ENABLED === 'true'
      ) {
        processedImageUrl =
          (await tryLocalPythonRemoveBg(user.client, id, primaryImage.storage_path)) ||
          processedImageUrl;
      }

      // If background removal succeeded, store as a NEW image row and promote
      // it to primary (rather than overwriting the raw wide-shot in place).
      if (processedImageUrl !== primaryImage.storage_path) {
        const { data: newImg, error: insertErr } = await user.client
          .from('garment_images')
          .insert({
            garment_id: id,
            storage_path: processedImageUrl,
            is_primary_profile: true,
            asset_type: 'profile',
          })
          .select()
          .single();
        if (!insertErr && newImg) {
          await user.client
            .from('garment_images')
            .update({ is_primary_profile: false })
            .eq('garment_id', id)
            .neq('id', newImg.id);
        }
      }

      // 5. Persist AI metadata.
      const { error: updateError } = await user.client
        .from('garments')
        .update({
          category: parsed.category,
          sub_category: parsed.sub_category,
          style_detail: parsed.style_detail || null,
          brand: parsed.brand === 'Unknown' ? null : parsed.brand,
          color_family: parsed.color_family,
          hex_code: parsed.hex_code,
          tonal_value: parsed.tonal_value,
          fabric_type: parsed.fabric_type,
          fit_block: parsed.fit_block,
          status: 'Active',
          ai_extracted_json: parsed,
        })
        .eq('id', id);

      if (updateError) throw new Error(`DB update failed: ${updateError.message}`);

      const promptTokens = response.usageMetadata?.promptTokenCount || 0;
      const candidatesTokens = response.usageMetadata?.candidatesTokenCount || 0;
      await logTelemetry(
        'Gemini_Vision_Ingest',
        promptTokens,
        candidatesTokens,
        { garmentId: id, imagesCount: imagesList.length },
        { client: user.client, userId: user.id }
      );

      const bgSuccess = processedImageUrl !== primaryImage.storage_path;
      return {
        id,
        success: true,
        backgroundRemovalSuccess: bgSuccess,
        error: bgSuccess
          ? undefined
          : 'Background removal skipped (no provider configured or all providers failed).',
      };
    } catch (err: any) {
      console.error(`Error processing batch item ${id}:`, err);
      const { data: currentGarment } = await user.client
        .from('garments')
        .select('notes')
        .eq('id', id)
        .single();
      const errorMsg = err.message || 'Processing failed.';
      const combinedNotes = currentGarment?.notes
        ? `${currentGarment.notes}\n\n[Ingestion Error: ${errorMsg}]`
        : `[Ingestion Error: ${errorMsg}]`;
      await user.client
        .from('garments')
        .update({ status: 'Processing_Failed', notes: combinedNotes })
        .eq('id', id);
      return { id, success: false, error: err.message };
    }
  }

  const results = await limit(ids, 5, processOne);
  return ok({ results });
});

// ── Background removal helpers ────────────────────────────────────────────
// Each returns the public URL of the cutout on success, or `null` on failure.

async function tryRemoveBg(client: any, garmentId: string, srcUrl: string): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.append('image_url', srcUrl);
    fd.append('size', 'auto');
    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY! },
      body: fd,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await (await res.blob()).arrayBuffer());
    const fileName = `processed/${garmentId}-${Date.now()}.png`;
    const { error } = await client.storage.from('wardrobe-images').upload(fileName, buf, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) return null;
    const { data } = client.storage.from('wardrobe-images').getPublicUrl(fileName);
    return data.publicUrl;
  } catch (err) {
    console.error('Remove.bg failed:', err);
    return null;
  }
}

async function tryHFRemoveBg(client: any, garmentId: string, srcUrl: string): Promise<string | null> {
  try {
    const imgRes = await fetch(srcUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) return null;
    const buf = Buffer.from(await (await imgRes.blob()).arrayBuffer());
    const res = await fetch('https://api-inference.huggingface.co/models/briaai/RMBG-1.4', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN!}`,
        'Content-Type': 'application/octet-stream',
      },
      body: buf,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const cutoutBuf = Buffer.from(await res.arrayBuffer());
    const fileName = `processed/${garmentId}-${Date.now()}.png`;
    const { error } = await client.storage.from('wardrobe-images').upload(fileName, cutoutBuf, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) return null;
    const { data } = client.storage.from('wardrobe-images').getPublicUrl(fileName);
    return data.publicUrl;
  } catch (err) {
    console.error('HF RMBG-1.4 failed:', err);
    return null;
  }
}

async function tryLocalPythonRemoveBg(
  client: any,
  garmentId: string,
  srcUrl: string
): Promise<string | null> {
  // Only call this in self-hosted deployments with BG_REMOVAL_LOCAL_ENABLED=true.
  // Serverless environments won't have python3 on PATH and won't have writable
  // /tmp persistence beyond a single invocation.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { execSync } = await import('node:child_process');

  try {
    const imgRes = await fetch(srcUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) return null;
    const buf = Buffer.from(await (await imgRes.blob()).arrayBuffer());

    const tempDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempIn = path.join(tempDir, `in-${garmentId}.jpg`);
    const tempOut = path.join(tempDir, `out-${garmentId}.png`);
    fs.writeFileSync(tempIn, buf);

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
      console.error('Python process failed:', execErr.stdout?.toString(), execErr.stderr?.toString());
      return null;
    }

    if (!fs.existsSync(tempOut)) return null;
    const cutoutBuf = fs.readFileSync(tempOut);
    const fileName = `processed/${garmentId}-${Date.now()}.png`;
    const { error } = await client.storage.from('wardrobe-images').upload(fileName, cutoutBuf, {
      contentType: 'image/png',
      upsert: true,
    });
    if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
    if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
    if (error) return null;
    const { data } = client.storage.from('wardrobe-images').getPublicUrl(fileName);
    return data.publicUrl;
  } catch (err) {
    console.error('Local Python remove-bg failed:', err);
    return null;
  }
}