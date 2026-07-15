import { describe, expect, it } from 'vitest';
import { hasCatalogSource } from './catalog-source';

describe('hasCatalogSource', () => {
  it('accepts a Studio source crop', () => {
    expect(hasCatalogSource({ bucket: 'wardrobe-catalog', storage_path: 'user/item/crop.jpg' })).toBe(true);
  });

  it('accepts a retained legacy primary image', () => {
    expect(hasCatalogSource(null, 'raw/item-primary.jpg')).toBe(true);
  });

  it('does not claim an item without image evidence is eligible', () => {
    expect(hasCatalogSource({ bucket: 'wardrobe-catalog' }, null)).toBe(false);
  });
});
