import { describe, expect, it } from 'vitest';
import { buildGarmentDisplayName } from './garment-name';

describe('buildGarmentDisplayName', () => {
  it('uses brand, color, and subcategory in closet order', () => {
    expect(buildGarmentDisplayName({ brand: 'L.L.Bean', color: 'Brown', subcategory: 'Moccasin' }))
      .toBe('L.L.Bean Brown Moccasin');
  });

  it('omits unknown metadata', () => {
    expect(buildGarmentDisplayName({ brand: 'Unknown', color: 'White', subcategory: 'Dress Shirt' }))
      .toBe('White Dress Shirt');
  });
});
