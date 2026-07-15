import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';
import { logTelemetry } from '@/lib/telemetry';
import { assertPublicHttpsUrl } from '@/lib/url-safety';

const BING_SEARCH_KEY = process.env.BING_SEARCH_KEY || '';
const SERPER_API_KEY = process.env.SERPER_API_KEY || '';
const GOOGLE_CSE_KEY = process.env.GOOGLE_CSE_KEY || '';
const GOOGLE_CSE_CX = process.env.GOOGLE_CSE_CX || '';

// POST: Search the web for clean manufacturer images
export const POST = withUser(async ({ user, request }) => {
  const { brand, description } = await request.json();

  if (!brand && !description) {
    return fail(400, 'Please provide at least a brand or a description.');
  }

  const cleanSearchQuery = `${brand || ''} ${description || ''}`.trim();
  console.log(`[image-search] Query: "${cleanSearchQuery}"`);

  // ── PATH 1: Bing Image Search ────────────────────────────────────────────
  if (BING_SEARCH_KEY) {
    try {
      const q = encodeURIComponent(`${cleanSearchQuery} product photo`);
      const bingUrl = `https://api.bing.microsoft.com/v7.0/images/search?q=${q}&count=8&imageType=Photo&safeSearch=Moderate`;

      const res = await fetch(bingUrl, {
        headers: { 'Ocp-Apim-Subscription-Key': BING_SEARCH_KEY },
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const data = await res.json();
        const images = (data.value || []).map((item: any) => ({
          url: item.contentUrl,
          source: item.hostPageDisplayUrl || item.hostPageUrl || 'Bing Images',
          title: item.name || cleanSearchQuery
        }));
        await logTelemetry('Gemini_Search_Image', 0, 0, { brand, query: cleanSearchQuery, engine: 'bing', results: images.length }, { client: user.client, userId: user.id });
        return ok({ images: images.slice(0, 8) });
      } else {
        const errText = await res.text();
        console.warn('[image-search] Bing error:', res.status, errText);
      }
    } catch (bingErr: any) {
      console.error('[image-search] Bing failed, trying next:', bingErr.message);
    }
  }

  // ── PATH 2: Serper.dev (Google Image search proxy) ──────────────────────
  if (SERPER_API_KEY) {
    try {
      const res = await fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: `${cleanSearchQuery} product photo`, num: 8 }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const data = await res.json();
        const images = (data.images || []).map((item: any) => ({
          url: item.imageUrl,
          source: item.source || 'Google Images',
          title: item.title || cleanSearchQuery
        }));
        await logTelemetry('Gemini_Search_Image', 0, 0, { brand, query: cleanSearchQuery, engine: 'serper', results: images.length }, { client: user.client, userId: user.id });
        return ok({ images: images.slice(0, 8) });
      } else {
        const errText = await res.text();
        console.warn('[image-search] Serper error:', res.status, errText);
      }
    } catch (serperErr: any) {
      console.error('[image-search] Serper failed, trying next:', serperErr.message);
    }
  }

  // ── PATH 3: Google CSE (legacy engines with "Search the entire web" ON) ─
  if (GOOGLE_CSE_KEY && GOOGLE_CSE_CX) {
    try {
      const allImages: { url: string; source: string; title: string }[] = [];
      const queries = [`${cleanSearchQuery} product photo`, `${cleanSearchQuery} official`];

      for (const q of queries) {
        if (allImages.length >= 8) break;
        const url = new URL('https://www.googleapis.com/customsearch/v1');
        url.searchParams.set('key', GOOGLE_CSE_KEY);
        url.searchParams.set('cx', GOOGLE_CSE_CX);
        url.searchParams.set('searchType', 'image');
        url.searchParams.set('q', q);
        url.searchParams.set('num', '5');
        url.searchParams.set('imgType', 'photo');
        url.searchParams.set('safe', 'active');

        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
          const errText = await res.text();
          console.warn('[image-search] CSE error:', res.status, errText);
          break;
        }
        const data = await res.json();
        for (const item of (data.items || [])) {
          if (!allImages.find((i) => i.url === item.link)) {
            allImages.push({
              url: item.link,
              source: item.displayLink || 'Google Images',
              title: item.title || cleanSearchQuery
            });
          }
        }
      }

      if (allImages.length > 0) {
        await logTelemetry('Gemini_Search_Image', 0, 0, { brand, query: cleanSearchQuery, engine: 'google_cse', results: allImages.length }, { client: user.client, userId: user.id });
        return ok({ images: allImages.slice(0, 8) });
      }
    } catch (cseErr: any) {
      console.error('[image-search] CSE failed, trying Gemini grounding:', cseErr.message);
    }
  }

  // ── PATH 4: Gemini Grounding (last resort) ──────────────────────────────
  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  if (!geminiApiKey) {
    // Return 200 with empty array + a hint message so the UI shows
    // "no results" instead of crashing.
    return new Response(
      JSON.stringify({
        success: false,
        error: 'No image search engine configured. Add BING_SEARCH_KEY or SERPER_API_KEY to your Vercel environment variables.',
        images: []
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: geminiApiKey });

  const queryText = `Find 6 direct, high-quality product image URLs (ending in .jpg, .jpeg, .png, or .webp) for the exact garment: "${cleanSearchQuery}". Search only official brand sites, Nordstrom, SSENSE, Farfetch, Mr Porter, or similar premium fashion retailers. Return ONLY direct image file URLs — no redirect links, no HTML page links.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: [{ text: queryText }],
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          images: {
            type: 'ARRAY',
            description: 'Direct product image URLs from brand or retailer CDNs.',
            items: {
              type: 'OBJECT',
              properties: {
                url: { type: 'STRING', description: 'Direct image URL ending in .jpg/.png/.webp' },
                source: { type: 'STRING', description: 'Retailer or brand name (e.g., Nordstrom)' },
                title: { type: 'STRING', description: 'Product title' }
              },
              required: ['url', 'source']
            }
          }
        },
        required: ['images']
      }
    }
  });

  const text = response.text;
  if (!text) return ok({ images: [] });

  const parsed = JSON.parse(text);
  const promptTokens = response.usageMetadata?.promptTokenCount || 0;
  const candidatesTokens = response.usageMetadata?.candidatesTokenCount || 0;
  await logTelemetry('Gemini_Search_Image', promptTokens, candidatesTokens, { brand, query: cleanSearchQuery, engine: 'gemini_grounding' }, { client: user.client, userId: user.id });

  return ok({ images: parsed.images || [] });
});

// PUT: Download the chosen manufacturer image and add it as a new image
export const PUT = withUser(async ({ user, request }) => {
  const { garmentId, imageUrl } = await request.json();

  if (!garmentId || !imageUrl) return fail(400, 'Missing garmentId or imageUrl.');

  // SSRF guard: refuse private/loopback hosts before issuing the fetch.
  try {
    await assertPublicHttpsUrl(imageUrl);
  } catch (err: any) {
    return fail(400, `Refused image URL: ${err.message}`);
  }

  // Verify ownership.
  const { data: garment, error: ownErr } = await user.client
    .from('garments')
    .select('id')
    .eq('id', garmentId)
    .single();
  if (ownErr || !garment) return fail(404, 'Garment not found.');

  console.log(`[image-replace] Downloading for garment ${garmentId}: ${imageUrl}`);

  const imageResponse = await fetch(imageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.google.com/'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  });

  if (!imageResponse.ok) {
    return fail(400, `Failed to download image: HTTP ${imageResponse.status}`);
  }

  const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    return fail(400, `URL does not point to an image (got ${contentType})`);
  }

  const blob = await imageResponse.blob();
  const buffer = Buffer.from(await blob.arrayBuffer());

  const { data: existingImages } = await user.client
    .from('garment_images')
    .select('id')
    .eq('garment_id', garmentId);

  const isFirst = !existingImages || existingImages.length === 0;

  const ext = contentType.split('/').pop()?.split(';')[0] || 'jpg';
  const fileName = `raw/${garmentId}-added-${Date.now()}.${ext}`;

  const { error: uploadError } = await user.client.storage
    .from('wardrobe-images')
    .upload(fileName, buffer, { contentType, upsert: true });

  if (uploadError) return fail(500, `Storage upload failed: ${uploadError.message}`);

  const { data: { publicUrl } } = user.client.storage.from('wardrobe-images').getPublicUrl(fileName);

  const { data: newImage, error: insertError } = await user.client
    .from('garment_images')
    .insert({
      garment_id: garmentId,
      storage_path: publicUrl,
      is_primary_profile: isFirst,
      asset_type: isFirst ? 'profile' : 'detail'
    })
    .select()
    .single();

  if (insertError) return fail(500, `DB insert failed: ${insertError.message}`);

  const { data: allImages } = await user.client
    .from('garment_images')
    .select('*')
    .eq('garment_id', garmentId);

  await user.client.from('garments').update({ status: 'Active', updated_at: new Date().toISOString() }).eq('id', garmentId);
  return ok({ url: publicUrl, images: allImages || [] });
});