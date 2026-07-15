import sharp from 'sharp';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export type ChromaResult = {
  png: Buffer;
  width: number;
  height: number;
  visibleRatio: number;
  cornersTransparent: boolean;
};

export async function removeChromaKey(input: Buffer, chromaKey: string): Promise<ChromaResult> {
  const image = sharp(input).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const [kr, kg, kb] = hexToRgb(chromaKey);
  let visiblePixels = 0;

  for (let index = 0; index < data.length; index += 4) {
    const distance = Math.max(
      Math.abs(data[index] - kr),
      Math.abs(data[index + 1] - kg),
      Math.abs(data[index + 2] - kb)
    );
    const alpha = Math.round(255 * smoothstep(14, 150, distance));
    data[index + 3] = Math.min(data[index + 3], alpha);

    if (alpha > 12) visiblePixels += 1;
    if (alpha < 250) {
      if (kg > kr && kg > kb) data[index + 1] = Math.min(data[index + 1], Math.max(data[index], data[index + 2]));
      if (kr > kg && kr > kb) data[index] = Math.min(data[index], Math.max(data[index + 1], data[index + 2]));
      if (kb > kr && kb > kg) data[index + 2] = Math.min(data[index + 2], Math.max(data[index], data[index + 1]));
    }
    if (alpha === 0) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
    }
  }

  const pixelCount = info.width * info.height;
  const corners = [0, info.width - 1, (info.height - 1) * info.width, pixelCount - 1];
  const cornersTransparent = corners.every((pixel) => data[pixel * 4 + 3] < 24);
  const png = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer();

  return {
    png,
    width: info.width,
    height: info.height,
    visibleRatio: visiblePixels / pixelCount,
    cornersTransparent,
  };
}
