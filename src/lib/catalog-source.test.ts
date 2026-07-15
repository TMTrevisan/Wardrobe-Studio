import { describe, expect, it } from 'vitest';
import { getLegacyStorageLocation, hasCatalogSource } from './catalog-source';

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

describe('getLegacyStorageLocation', () => {
  const projectUrl = 'https://project.supabase.co';

  it('parses a legacy public-shaped URL for authenticated storage access', () => {
    expect(getLegacyStorageLocation(
      'https://project.supabase.co/storage/v1/object/public/wardrobe-images/raw/shoe%20photo.jpg',
      projectUrl,
    )).toEqual({ bucket: 'wardrobe-images', path: 'raw/shoe photo.jpg' });
  });

  it('rejects a URL from another host', () => {
    expect(getLegacyStorageLocation('https://elsewhere.example/image.jpg', projectUrl)).toBeNull();
  });
});
