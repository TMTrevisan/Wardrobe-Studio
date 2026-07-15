import { NextResponse } from 'next/server';
import { ok } from '@/lib/api';

export async function POST(request: Request) {
  try {
    const { prompt } = await request.json();

    if (!prompt) {
      return NextResponse.json({ error: 'No prompt provided.' }, { status: 400 });
    }

    const hfToken = process.env.HF_TOKEN || '';

    // No HF_TOKEN configured: return a clear, actionable error AND a
    // placeholder SVG so the UI can still render something instead of a
    // broken image. The frontend surfaces the message via toast.
    if (!hfToken) {
      console.warn('HF_TOKEN not configured — returning placeholder.');
      return ok({
        url: makePlaceholderSvg(prompt),
        isMock: true,
        message:
          'HF_TOKEN is not configured on the server. Add it to your Vercel environment variables to enable real AI image generation. (See .env.example for setup.)',
      });
    }

    console.log(`Starting AI outfit generation with prompt: "${prompt}"`);

    const hfResponse = await fetch(
      'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: prompt }),
        signal: AbortSignal.timeout(60_000),
      }
    );

    if (!hfResponse.ok) {
      const errText = await hfResponse.text();
      console.error(`Hugging Face T2I failed with status ${hfResponse.status}:`, errText);
      // 503 from HF means the model is loading — surface that explicitly so
      // the user knows to retry in a minute.
      const friendly =
        hfResponse.status === 503
          ? 'The Hugging Face model is still loading. Try again in 30–60 seconds.'
          : `Image generation failed (${hfResponse.status}). Check HF_TOKEN.`;
      return NextResponse.json({ error: friendly, detail: errText }, { status: 502 });
    }

    const arrayBuffer = await hfResponse.arrayBuffer();
    if (arrayBuffer.byteLength < 1000) {
      // FLUX sometimes returns a tiny JSON error wrapped as the body.
      const text = Buffer.from(arrayBuffer).toString('utf-8');
      console.warn('HF returned non-image body:', text.slice(0, 200));
      return NextResponse.json(
        { error: 'HF returned a non-image response. The model may still be loading.' },
        { status: 502 }
      );
    }

    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64Data}`;

    return ok({ url: dataUrl });
  } catch (error: any) {
    console.error('Generative outfit API error:', error);
    return NextResponse.json(
      { error: error.message || 'An error occurred during image generation' },
      { status: 500 }
    );
  }
}

/**
 * Generates a tiny inline SVG that previews the prompt text on a warm
 * Atelier-toned background. Lets the UI render *something* even when the
 * upstream image model is unavailable.
 */
function makePlaceholderSvg(prompt: string): string {
  const truncated = prompt.length > 240 ? prompt.slice(0, 237) + '…' : prompt;
  const safe = truncated.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 768">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F9F6F0"/>
      <stop offset="100%" stop-color="#EAE5D9"/>
    </linearGradient>
  </defs>
  <rect width="768" height="768" fill="url(#bg)"/>
  <text x="50%" y="42%" text-anchor="middle" font-family="system-ui, sans-serif" font-size="36" fill="#C86B55" font-weight="800">AI Flat-Lay Preview</text>
  <text x="50%" y="55%" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" fill="#3A3530" font-weight="600">
    <tspan x="50%" dy="0">${safe.split(' ').slice(0, 12).join(' ')}</tspan>
    <tspan x="50%" dy="28">${safe.split(' ').slice(12, 24).join(' ')}</tspan>
    <tspan x="50%" dy="28">${safe.split(' ').slice(24, 36).join(' ')}</tspan>
  </text>
  <text x="50%" y="92%" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="#6E655C" font-weight="700">Configure HF_TOKEN to generate real images</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}