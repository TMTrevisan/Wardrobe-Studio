import { describe, expect, it } from 'vitest';
import { getLegacyWardrobeImagePath } from './storage-path';

describe('getLegacyWardrobeImagePath', () => {
  it('extracts an object path from a legacy Supabase public URL', () => {
    expect(getLegacyWardrobeImagePath(
      'https://example.supabase.co/storage/v1/object/public/wardrobe-images/raw/item%20one.jpg',
    )).toBe('raw/item one.jpg');
  });

  it('rejects unrelated and malformed values', () => {
    expect(getLegacyWardrobeImagePath('https://example.com/photo.jpg')).toBeNull();
    expect(getLegacyWardrobeImagePath(null)).toBeNull();
  });
});
