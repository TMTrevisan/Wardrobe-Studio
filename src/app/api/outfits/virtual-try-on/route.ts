import { NextResponse } from 'next/server';
import { ok } from '@/lib/api';

export async function POST(request: Request) {
  try {
    const { personImage, garmentImage, category } = await request.json();

    if (!personImage || !garmentImage) {
      return NextResponse.json({ error: 'Missing personImage or garmentImage.' }, { status: 400 });
    }

    const replicateToken = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY || '';
    if (!replicateToken) {
      // Mock Try-On output for local sandbox testing
      console.warn('REPLICATE_API_TOKEN is not set. Returning demo VTON output.');
      return NextResponse.json({
        success: true,
        isMock: true,
        url: garmentImage, // Mock: returns the garment image back as try-on
        message: 'Mock Virtual Try-On: Please set REPLICATE_API_TOKEN in your environment to enable real AI try-on models (e.g. yisol/idm-vton).'
      });
    }

    console.log(`Starting Replicate VTON for category: ${category}`);

    // Call Replicate API to run IDM-VTON
    const replicateResponse = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${replicateToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: '035e52c85b7ffdbf0c12859b3f3b90f4c39cc2e48227b68266ed0f2a969623e1', // IDM-VTON model version hash
        input: {
          crop: true,
          seed: 42,
          steps: 30,
          category: category === 'tops' || category === 'outerwear' ? 'upper_body' : category === 'bottoms' ? 'lower_body' : 'overall',
          human_img: personImage,
          garm_img: garmentImage,
          garment_des: 'a clean product flat-lay'
        }
      })
    });

    if (!replicateResponse.ok) {
      const errText = await replicateResponse.text();
      console.error('Replicate VTON failed:', errText);
      return NextResponse.json({ error: `Replicate API error: ${errText || replicateResponse.statusText}` }, { status: 500 });
    }

    const prediction = await replicateResponse.json();
    let resultUrl = '';

    // Poll the prediction status
    const pollUrl = prediction.urls.get;
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const pollRes = await fetch(pollUrl, {
        headers: {
          'Authorization': `Token ${replicateToken}`,
        }
      });
      if (!pollRes.ok) break;
      const pollData = await pollRes.json();
      if (pollData.status === 'succeeded') {
        resultUrl = pollData.output;
        break;
      } else if (pollData.status === 'failed') {
        throw new Error(`Try-on prediction failed: ${pollData.error}`);
      }
    }

    if (!resultUrl) {
      return NextResponse.json({ error: 'Virtual Try-On timed out. Try again later.' }, { status: 504 });
    }

    return ok({ url: resultUrl });
  } catch (error: any) {
    console.error('VTON API error:', error);
    return NextResponse.json({ error: error.message || 'An error occurred during virtual try-on' }, { status: 500 });
  }
}
export const maxDuration = 60; // Allow enough time for polling Replicate (Vercel deployment max timeout)
