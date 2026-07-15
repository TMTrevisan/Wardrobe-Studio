import { describe, it, expect } from 'vitest';
import { getItemWornCount, getItemCostPerWear, hexToRgb, filterGarments } from './garment-utils';
import type { Garment, WearLog } from '@/types/db';

const garment: Garment = {
  id: 'g1',
  category: 'Tops',
  sub_category: 'T-Shirt',
  brand: 'Acme',
  color_family: 'Olive',
  hex_code: '#556b2f',
  tonal_value: 'Medium',
  fabric_type: 'Cotton',
  fit_block: 'Regular',
  style_detail: null,
  status: 'Active',
  images: [],
  primary_image_url: null,
  notes: null,
  price: 60,
  purchase_year: 2023,
  created_at: '2026-01-01T00:00:00Z',
};

describe('getItemWornCount()', () => {
  it('counts wear logs for the given garment', () => {
    const logs: WearLog[] = [
      { id: '1', garment_id: 'g1', worn_at: '' },
      { id: '2', garment_id: 'g2', worn_at: '' },
      { id: '3', garment_id: 'g1', worn_at: '' },
    ];
    expect(getItemWornCount('g1', logs)).toBe(2);
  });
  it('returns 0 for unknown id', () => {
    expect(getItemWornCount('missing', [])).toBe(0);
  });
});

describe('getItemCostPerWear()', () => {
  it('returns price when never worn', () => {
    expect(getItemCostPerWear(garment, 0)).toBe(60);
  });
  it('returns price / wears', () => {
    expect(getItemCostPerWear(garment, 3)).toBe(20);
  });
  it('returns 0 when price is missing', () => {
    expect(getItemCostPerWear({ ...garment, price: 0 }, 3)).toBe(0);
  });
});

describe('hexToRgb()', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#556b2f')).toEqual({ r: 0x55, g: 0x6b, b: 0x2f });
  });
  it('parses 3-digit hex by doubling', () => {
    expect(hexToRgb('#f0a')).toEqual({ r: 0xff, g: 0x00, b: 0xaa });
  });
  it('handles missing # prefix', () => {
    expect(hexToRgb('556b2f')).toEqual({ r: 0x55, g: 0x6b, b: 0x2f });
  });
  it('returns null on garbage', () => {
    expect(hexToRgb('zzz')).toBeNull();
    expect(hexToRgb(null)).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });
});

describe('filterGarments()', () => {
  const items: Garment[] = [
    garment,
    { ...garment, id: 'g2', category: 'Bottoms', brand: 'Beta', sub_category: 'Chinos' },
    { ...garment, id: 'g3', status: 'Donate', brand: 'Gamma' },
    { ...garment, id: 'g4', color_family: 'Navy' },
  ];

  it('returns everything when no filters set', () => {
    expect(filterGarments(items, {})).toHaveLength(4);
  });
  it('filters by category (ignoring "All")', () => {
    expect(filterGarments(items, { category: 'Tops' })).toHaveLength(3);
    expect(filterGarments(items, { category: 'All' })).toHaveLength(4);
  });
  it('filters by status', () => {
    expect(filterGarments(items, { status: 'Donate' })).toHaveLength(1);
  });
  it('filters by color', () => {
    expect(filterGarments(items, { color: 'Navy' })).toHaveLength(1);
  });
  it('searches brand / sub_category / notes', () => {
    expect(filterGarments(items, { search: 'beta' })).toHaveLength(1);
    expect(filterGarments(items, { search: 'chinos' })).toHaveLength(1);
  });
  it('combines filters with AND', () => {
    expect(filterGarments(items, { category: 'Tops', status: 'Donate' })).toHaveLength(1);
  });
});