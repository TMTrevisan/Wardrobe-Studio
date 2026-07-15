import { describe, it, expect } from 'vitest';
import { scoreOutfit, filterValidOutfits, checkCompleteness, SCORE_MATCH, SCORE_CLASH } from './styling-rules';
import type { Garment } from '@/types/db';

const base = {
  id: 'g1',
  category: 'Tops',
  sub_category: 'T-Shirt',
  brand: null,
  color_family: 'Olive',
  hex_code: null,
  tonal_value: 'Medium',
  fabric_type: 'Cotton',
  fit_block: 'Regular',
  style_detail: null,
  status: 'Active',
  images: [],
  primary_image_url: null,
  notes: null,
  price: 50,
  purchase_year: null,
  created_at: '',
} as Garment;

describe('filterValidOutfits()', () => {
  const a = { ...base, id: 'a' };
  const b = { ...base, id: 'b' };
  const c = { ...base, id: 'c' };

  it('keeps outfits whose UUIDs all exist', () => {
    const outfits = [{ item_ids: ['a', 'b'] }, { item_ids: ['b', 'c'] }];
    expect(filterValidOutfits(outfits, [a, b, c])).toHaveLength(2);
  });

  it('drops outfits with hallucinated UUIDs', () => {
    const outfits = [
      { item_ids: ['a', 'b'] },
      { item_ids: ['a', 'ghost-uuid'] },
      { item_ids: ['ghost-1', 'ghost-2'] },
    ];
    const result = filterValidOutfits(outfits, [a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].item_ids).toEqual(['a', 'b']);
  });

  it('handles empty wardrobe', () => {
    expect(filterValidOutfits([{ item_ids: ['a'] }], [])).toHaveLength(0);
  });
});

describe('scoreOutfit()', () => {
  const lightTop = { ...base, id: 'top', tonal_value: 'Light', color_family: 'White', category: 'Tops' } as Garment;
  const darkBottom = { ...base, id: 'bot', tonal_value: 'Dark', color_family: 'Navy', category: 'Bottoms' } as Garment;
  const sneaker = { ...base, id: 'shoe', category: 'Footwear', sub_category: 'Sneakers', fabric_type: 'Canvas' } as Garment;
  const woolTop = { ...base, id: 'wool', fabric_type: 'Wool', category: 'Outerwear' } as Garment;

  it('marks valid outfit as valid: true', () => {
    const result = scoreOutfit(['top', 'bot', 'shoe'], [lightTop, darkBottom, sneaker], {});
    expect(result.valid).toBe(true);
  });

  it('marks outfits with hallucinated UUIDs as invalid', () => {
    const result = scoreOutfit(['top', 'bot', 'ghost'], [lightTop, darkBottom], {});
    expect(result.valid).toBe(false);
  });

  it('penalizes sneakers in a formal event context', () => {
    const casual = scoreOutfit(['top', 'bot', 'shoe'], [lightTop, darkBottom, sneaker], { event: 'Weekend Lounge' });
    const formal = scoreOutfit(['top', 'bot', 'shoe'], [lightTop, darkBottom, sneaker], { event: 'Date Night' });
    expect(formal.total).toBeLessThan(casual.total);
  });

  it('rewards wool in cold weather', () => {
    // Two items so there are pairs to score.
    const pants = { ...base, id: 'pants', category: 'Bottoms', fabric_type: 'Cotton' } as Garment;
    const withWool = scoreOutfit(['wool', 'pants'], [woolTop, pants], { weather: '20F snowy' });
    const withoutWool = scoreOutfit(['top', 'pants'], [lightTop, pants], { weather: '20F snowy' });
    expect(withWool.total).toBeGreaterThan(withoutWool.total);
  });

  it('penalizes wool in warm weather (via breathableInHeat not matching)', () => {
    const pants = { ...base, id: 'pants', category: 'Bottoms', fabric_type: 'Cotton' } as Garment;
    const coldWeather = scoreOutfit(['wool', 'pants'], [woolTop, pants], { weather: '20F snowy' });
    const warmWeather = scoreOutfit(['wool', 'pants'], [woolTop, pants], { weather: '85F sunny' });
    expect(warmWeather.total).toBeLessThanOrEqual(coldWeather.total);
  });

  it('breakdown sums pair-wise rule scores', () => {
    // 2 items → 1 pair. 6 rules → 6 breakdown entries.
    const result = scoreOutfit(['top', 'bot'], [lightTop, darkBottom], {});
    expect(result.breakdown).toHaveLength(6);
    // Each breakdown entry has a ruleId and score.
    for (const entry of result.breakdown) {
      expect(entry.ruleId).toBeTruthy();
      expect([SCORE_MATCH, 1, SCORE_CLASH]).toContain(entry.score);
    }
  });
});

describe('checkCompleteness()', () => {
  const top = { ...base, id: 'top', category: 'Tops' } as Garment;
  const bottom = { ...base, id: 'bot', category: 'Bottoms' } as Garment;
  const footwear = { ...base, id: 'shoe', category: 'Footwear' } as Garment;
  const outerwear = { ...base, id: 'coat', category: 'Outerwear' } as Garment;
  const tailoring = { ...base, id: 'blazer', category: 'Tailoring' } as Garment;

  it('flags incomplete outfits missing a top', () => {
    const c = checkCompleteness(['bot', 'shoe'], [bottom, footwear]);
    expect(c.hasTop).toBe(false);
    expect(c.hasBottom).toBe(true);
    expect(c.isComplete).toBe(false);
  });

  it('flags incomplete outfits missing a bottom', () => {
    const c = checkCompleteness(['top', 'shoe'], [top, footwear]);
    expect(c.hasTop).toBe(true);
    expect(c.hasBottom).toBe(false);
    expect(c.isComplete).toBe(false);
  });

  it('accepts outfits with top + bottom', () => {
    const c = checkCompleteness(['top', 'bot'], [top, bottom]);
    expect(c.isComplete).toBe(true);
  });

  it('accepts tailoring as the top half', () => {
    // No regular Tops, but Tailoring counts as a top half.
    const c = checkCompleteness(['blazer', 'bot'], [tailoring, bottom]);
    expect(c.hasTop).toBe(true);
    expect(c.isComplete).toBe(true);
  });

  it('tracks footwear and outerwear separately', () => {
    const c = checkCompleteness(['top', 'bot', 'shoe', 'coat'], [top, bottom, footwear, outerwear]);
    expect(c.hasFootwear).toBe(true);
    expect(c.hasOuterwear).toBe(true);
    expect(c.isComplete).toBe(true);
  });

  it('marks invalid UUIDs as missing top/bottom (via lookup)', () => {
    const c = checkCompleteness(['top', 'ghost'], [top]);
    expect(c.hasTop).toBe(true);
    expect(c.hasBottom).toBe(false);
    expect(c.isComplete).toBe(false);
  });
});