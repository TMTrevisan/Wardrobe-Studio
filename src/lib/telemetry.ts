import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type TokenService =
  | 'Gemini_Vision_Ingest'
  | 'Gemini_Stylist_Engine'
  | 'Pirate_Weather_API'
  | 'Gemini_Search_Image'
  | 'OpenAI_Image_Edit';

// ponytail: image-edit flat rates by quality × size. Verify against
// https://openai.com/api/pricing/ before shipping a rate change.
const OPENAI_IMAGE_EDIT_USD: Record<string, Record<string, number>> = {
  '1024x1024': { low: 0.02, medium: 0.04, high: 0.17 },
  '816x816':   { low: 0.013, medium: 0.026, high: 0.11 },
};

export function getOpenAIImageEditCost(quality: string, size: string): number {
  return OPENAI_IMAGE_EDIT_USD[size]?.[quality] ?? 0.02;
}

/**
 * Logs token usage and estimated API cost to the billing_and_token_ledger
 * table. Pass the authenticated user's JWT-scoped client when available
 * so the row carries `user_id` and the per-user telemetry dashboard works.
 *
 * Gemini pricing (Gemini 3.1 Flash Lite, paid tier):
 *   Input:  $0.125 / 1M tokens  (free tier: $0 — opt-in training)
 *   Output: $0.75  / 1M tokens  (free tier: $0 — opt-in training)
 * Switch to `GEMINI_TIER=free` env var if you've opted into the free tier.
 *
 * OpenAI image edits are billed per-image, not per-token. Pass
 * `metadata.imageEdit = { quality, size }` to use the flat-rate table.
 */
export async function logTelemetry(
  service: TokenService,
  tokensIn: number,
  tokensOut: number,
  metadata?: Record<string, any>,
  options: { client?: SupabaseClient; userId?: string } = {}
) {
  try {
    const client = options.client ?? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    );

    let estimatedCost = 0;

    if (service === 'OpenAI_Image_Edit') {
      const quality = (metadata?.imageEdit?.quality as string) || 'low';
      const size = (metadata?.imageEdit?.size as string) || '1024x1024';
      estimatedCost = getOpenAIImageEditCost(quality, size);
    } else {
      const useFree = process.env.GEMINI_TIER === 'free';
      let costPerTokenIn = useFree ? 0 : 0.000000125;
      let costPerTokenOut = useFree ? 0 : 0.00000075;
      if (service === 'Pirate_Weather_API') {
        costPerTokenIn = 0.0001;
        costPerTokenOut = 0;
      }
      estimatedCost = (tokensIn * costPerTokenIn) + (tokensOut * costPerTokenOut);
    }

    const row: Record<string, unknown> = {
      service,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      estimated_cost: Number(estimatedCost.toFixed(6)),
      metadata: {
        ...metadata,
        env: process.env.NODE_ENV,
      },
    };
    if (options.userId) row.user_id = options.userId;

    const { error } = await client.from('billing_and_token_ledger').insert([row]);

    if (error) {
      console.warn('Telemetry insertion warning:', error.message);
    }
  } catch (err) {
    console.error('Failed to log telemetry:', err);
  }
}