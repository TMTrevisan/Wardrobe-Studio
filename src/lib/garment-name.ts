type GarmentNameInput = {
  brand?: string | null;
  color?: string | null;
  subcategory?: string | null;
  fallback?: string | null;
};

/** Keep garment names consistent with the original closet convention. */
export function buildGarmentDisplayName({ brand, color, subcategory, fallback }: GarmentNameInput): string {
  const parts = [brand, color, subcategory]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && !/^unknown$/i.test(part)));
  return parts.join(' ') || fallback?.trim() || 'Untitled garment';
}
