/**
 * Men's fashion styling rules.
 *
 * Each rule is a small pure function that takes two garments and returns
 * a score (0 = clash, 1 = neutral, 2 = strong match). Rules compose into
 * an outfit's total score; outfits are then ranked by total.
 *
 * This is intentionally a thin scaffold — fill in your own taste.
 *
 * To activate: the StylistTab (when extracted) should call
 * `scoreOutfit(outfit.item_ids, items, ctx)` and sort outfits by
 * `total` descending.
 */

import type { Garment } from '@/types/db';

export type Score = 0 | 1 | 2;
export const SCORE_CLASH = 0;
export const SCORE_NEUTRAL = 1;
export const SCORE_MATCH = 2;

export interface RuleContext {
  /** "Corporate Casual" | "Weekend Lounge" | "Date Night" | "Travel" | … */
  event?: string;
  /** Free-text weather description ("75F sunny", "32F snowy"). */
  weather?: string;
  /** Tonality preference passed in by the user. */
  preferredTonality?: 'Light' | 'Medium' | 'Dark' | 'mixed';
}

interface Rule {
  id: string;
  description: string;
  /** Returns a score for placing `b` next to `a`. */
  score: (a: Garment, b: Garment, ctx: RuleContext) => Score;
}

/* ─────────────────────────────────────────────────────────────────────
 * Color rules
 * ───────────────────────────────────────────────────────────────────── */

/** Same-color pairing — fine for monochromatic looks. */
const sameColor: Rule = {
  id: 'same-color',
  description: 'Both pieces in the same color family (monochromatic look).',
  score: (a, b) => (a.color_family === b.color_family ? SCORE_MATCH : SCORE_NEUTRAL),
};

/** High-contrast pairing — neutral unless user prefers subtle. */
const highContrast: Rule = {
  id: 'high-contrast',
  description: 'Light top + dark bottom (or vice versa) — balanced contrast.',
  score: (a, b, ctx) => {
    const aTone = a.tonal_value;
    const bTone = b.tonal_value;
    if (!aTone || !bTone) return SCORE_NEUTRAL;
    if (aTone === bTone) return SCORE_NEUTRAL;
    // TODO: only match this rule when one is top and other is bottom.
    //       Without that check, "light footwear + dark top" scores match, which
    //       isn't what we want.
    return SCORE_MATCH;
  },
};

/* ─────────────────────────────────────────────────────────────────────
 * Fabric + season rules
 * ───────────────────────────────────────────────────────────────────── */

/** Linen / cotton for warm weather. */
const breathableInHeat: Rule = {
  id: 'breathable-in-heat',
  description: 'Linen or cotton for warm weather.',
  score: (a, _b, ctx) => {
    if (!ctx.weather) return SCORE_NEUTRAL;
    const isWarm = /\b(7[0-9]|8[0-9]|9[0-9])/.test(ctx.weather); // 70-99°F
    const isBreathable = /linen|cotton/i.test(a.fabric_type || '');
    return isWarm && isBreathable ? SCORE_MATCH : isWarm ? SCORE_CLASH : SCORE_NEUTRAL;
  },
};

/** Wool / layering for cold weather. */
const warmInCold: Rule = {
  id: 'warm-in-cold',
  description: 'Wool, cashmere, or heavy layering for cold weather.',
  score: (a, _b, ctx) => {
    if (!ctx.weather) return SCORE_NEUTRAL;
    const isCold = /\b([0-3][0-9]|4[0-9])/.test(ctx.weather); // 0-49°F
    const isWarm = /wool|cashmere|fleece/i.test(a.fabric_type || '');
    return isCold && isWarm ? SCORE_MATCH : isCold ? SCORE_CLASH : SCORE_NEUTRAL;
  },
};

/* ─────────────────────────────────────────────────────────────────────
 * Silhouette + formality rules
 * ───────────────────────────────────────────────────────────────────── */

/** Tailoring for formal events. */
const tailoringForFormal: Rule = {
  id: 'tailoring-for-formal',
  description: 'Tailoring (blazer/sport coat) for formal events.',
  score: (a, _b, ctx) => {
    const isFormal = /corporate|date|formal/i.test(ctx.event || '');
    const isTailoring = a.category === 'Tailoring';
    return isFormal && isTailoring ? SCORE_MATCH : isFormal ? SCORE_CLASH : SCORE_NEUTRAL;
  },
};

/** Sneakers for casual; leather for formal. */
const footwearMatchesFormality: Rule = {
  id: 'footwear-formality',
  description: 'Sneakers for casual, leather/oxford for formal.',
  score: (a, _b, ctx) => {
    if (a.category !== 'Footwear') return SCORE_NEUTRAL;
    const isFormal = /corporate|date|formal/i.test(ctx.event || '');
    const isSneaker = /sneaker/i.test(a.sub_category);
    if (isFormal && isSneaker) return SCORE_CLASH;
    if (!isFormal && !isSneaker) return SCORE_NEUTRAL;
    return SCORE_MATCH;
  },
};

/* ─────────────────────────────────────────────────────────────────────
 * CPW fairness — promote under-worn items
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Note: this rule needs wear history, which isn't in Garment directly.
 * Pass it via RuleContext.workflow (we'll wire this up after the
 * closet is wired into the stylist flow).
 */
export const ALL_RULES: Rule[] = [
  sameColor,
  highContrast,
  breathableInHeat,
  warmInCold,
  tailoringForFormal,
  footwearMatchesFormality,
];

/**
 * Score every pair in an outfit and return the average.
 * O(items²) — fine for wardrobes up to a few hundred items.
 */
export function scoreOutfit(
  itemIds: string[],
  wardrobe: Map<string, Garment> | Garment[],
  ctx: RuleContext
): { total: number; breakdown: { ruleId: string; score: number }[]; valid: boolean } {
  const lookup =
    wardrobe instanceof Map ? wardrobe : new Map(wardrobe.map((g) => [g.id, g]));
  const items = itemIds.map((id) => lookup.get(id)).filter((g): g is Garment => !!g);
  if (items.length !== itemIds.length) {
    return { total: 0, breakdown: [], valid: false };
  }

  const breakdown: { ruleId: string; score: number }[] = [];
  let total = 0;
  let pairs = 0;

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      for (const rule of ALL_RULES) {
        const s = rule.score(a, b, ctx);
        breakdown.push({ ruleId: rule.id, score: s });
        total += s;
        pairs++;
      }
    }
  }

  return {
    total: pairs > 0 ? total / pairs : 0,
    breakdown,
    valid: true,
  };
}

/**
 * Filter out any outfit that references a UUID not in the wardrobe.
 * Critical: Gemini sometimes hallucinates UUIDs.
 */
export function filterValidOutfits<T extends { item_ids: string[] }>(
  outfits: T[],
  wardrobe: Garment[]
): T[] {
  const ids = new Set(wardrobe.map((g) => g.id));
  return outfits.filter((o) => o.item_ids.every((id) => ids.has(id)));
}

/**
 * Determine whether an outfit is "complete" — has at least one top
 * AND at least one bottom. Footwear and outerwear are optional but
 * tracked for tie-breaking.
 *
 * Gemini often drops the top (returns just sweater + shorts), so we
 * explicitly require both halves of the silhouette.
 */
export interface OutfitCompleteness {
  hasTop: boolean;
  hasBottom: boolean;
  hasFootwear: boolean;
  hasOuterwear: boolean;
  isComplete: boolean;
}

export function checkCompleteness(
  itemIds: string[],
  wardrobe: Map<string, Garment> | Garment[]
): OutfitCompleteness {
  const lookup = wardrobe instanceof Map ? wardrobe : new Map(wardrobe.map((g) => [g.id, g]));
  const items = itemIds.map((id) => lookup.get(id)).filter((g): g is Garment => !!g);

  const cats = items.map((i) => i.category.toLowerCase());
  const hasTop = cats.some((c) => c === 'tops' || c === 'tailoring'); // tailoring acts as top half
  const hasBottom = cats.some((c) => c === 'bottoms');
  const hasFootwear = cats.some((c) => c === 'footwear');
  const hasOuterwear = cats.some((c) => c === 'outerwear');

  return {
    hasTop,
    hasBottom,
    hasFootwear,
    hasOuterwear,
    isComplete: hasTop && hasBottom,
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * TODO: rules to add (waiting on user taste notes)
 * ─────────────────────────────────────────────────────────────────────
 *
 *  - Brand affinity: penalize outfit if 3+ items from the same fast-fashion brand.
 *  - Wears-per-month promotion: surface items worn < 1x in 60 days (under-utilized).
 *  - Color-wardrobe coverage: prefer outfits whose colors fill gaps
 *    (e.g. if you own no navy, rank navy outfits higher).
 *  - Season-aware: deprioritize linen in December, wool in July.
 *  - "Anti-rules": what you want to AVOID (logo-heavy in formal, etc).
 *
 *  Add them to ALL_RULES and bump the SCORE_CLASH to penalize appropriately.
 */