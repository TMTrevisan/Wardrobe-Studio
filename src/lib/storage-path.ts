const LEGACY_PUBLIC_MARKER = '/storage/v1/object/public/wardrobe-images/';

export function getLegacyWardrobeImagePath(value?: string | null): string | null {
  if (!value) return null;

  try {
    const pathname = value.startsWith('http') ? new URL(value).pathname : value;
    const markerIndex = pathname.indexOf(LEGACY_PUBLIC_MARKER);
    if (markerIndex === -1) return null;
    const objectPath = pathname.slice(markerIndex + LEGACY_PUBLIC_MARKER.length);
    return objectPath ? decodeURIComponent(objectPath) : null;
  } catch {
    return null;
  }
}
