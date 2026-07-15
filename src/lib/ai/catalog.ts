export const CATALOG_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
export type CatalogQuality = 'low' | 'medium' | 'high';
export const DEFAULT_CATALOG_SIZE = '816x816';

/**
 * GPT Image 2 accepts dimensions in 16px increments, with at least 655,360
 * pixels total. 816² is the smallest valid square canvas, which is ideal for
 * the small catalog tiles while using fewer output tokens than 1024².
 */
export function getCatalogSize(value = process.env.OPENAI_CATALOG_IMAGE_SIZE): string {
  if (!value || !/^\d+x\d+$/.test(value)) return DEFAULT_CATALOG_SIZE;

  const [width, height] = value.split('x').map(Number);
  const pixels = width * height;
  const ratio = Math.max(width, height) / Math.min(width, height);
  const valid = width <= 3840
    && height <= 3840
    && width % 16 === 0
    && height % 16 === 0
    && pixels >= 655_360
    && pixels <= 8_294_400
    && ratio <= 3;
  return valid ? value : DEFAULT_CATALOG_SIZE;
}

export function getCatalogQuality(value = process.env.OPENAI_IMAGE_QUALITY): CatalogQuality {
  return value === 'medium' || value === 'high' ? value : 'low';
}

export const CATALOG_QUALITY = getCatalogQuality();
export const CATALOG_SIZE = getCatalogSize();

const CHROMA_KEYS = ['#00FF00', '#FF00FF', '#00FFFF', '#0000FF', '#FFFF00'] as const;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

export function chooseChromaKey(colors: Array<string | null | undefined>): string {
  const garmentColors = colors
    .filter((color): color is string => Boolean(color && /^#[0-9a-f]{6}$/i.test(color)))
    .map(hexToRgb);

  if (garmentColors.length === 0) return CHROMA_KEYS[0];

  return CHROMA_KEYS.map((key) => {
    const [r, g, b] = hexToRgb(key);
    const nearest = Math.min(
      ...garmentColors.map(([gr, gg, gb]) => Math.hypot(r - gr, g - gg, b - gb))
    );
    return { key, nearest };
  }).sort((a, b) => b.nearest - a.nearest)[0].key;
}

type CatalogPromptInput = {
  name: string;
  category: string;
  color: string;
  material?: string | null;
  details?: string | null;
  chromaKey: string;
};

export function buildCatalogPrompt(input: CatalogPromptInput): string {
  return `
Use case: wardrobe catalog extraction.
The reference image shows the exact ${input.name} worn by a person.

Reconstruct ONLY the complete empty garment as a polished ecommerce catalog product photograph.
Remove the wearer, body, skin, hair, underlayers, adjacent clothing, hanger, mannequin, props, and scene.

Source-grounded identity:
- Category: ${input.category}
- Dominant color: ${input.color}
- Material or texture: ${input.material || 'preserve only what is visible in the reference'}
- Construction details: ${input.details || 'preserve only clearly visible construction'}

Do not redesign the garment. Do not invent logos, lettering, labels, pockets, seams, fasteners,
hardware, colors, graphics, or decoration that are not supported by the reference.
If a hidden detail is uncertain, use the simplest construction consistent with visible evidence.

Composition: one garment only, centered front-facing product view, complete silhouette fully inside a
square canvas with generous even padding. Include every sleeve, cuff, strap, hem, leg, toe, or endpoint.
Neutral diffuse premium ecommerce lighting on the garment only. No cast shadow or contact shadow.

Background: perfectly flat, absolutely uniform ${input.chromaKey} edge-to-edge. No gradient, texture,
floor, horizon, vignette, reflection, border, or lighting variation. Do not use ${input.chromaKey}
anywhere in the garment. Keep a crisp separable outer silhouette.
`.trim();
}
