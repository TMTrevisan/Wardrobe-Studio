export type NormalizedBoundingBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function normalizeDetectionBoundingBox(bbox: NormalizedBoundingBox): NormalizedBoundingBox {
  const values = [bbox.left, bbox.top, bbox.right, bbox.bottom].map((value) => Number(value) || 0);
  // Gemini commonly returns its native 0–1000 image coordinates even when asked for 0–1.
  const scale = Math.max(...values.map(Math.abs)) > 1.5 ? 1000 : 1;
  const left = clamp(values[0] / scale, 0, 0.99);
  const top = clamp(values[1] / scale, 0, 0.99);
  return {
    left,
    top,
    right: clamp(values[2] / scale, left + 0.01, 1),
    bottom: clamp(values[3] / scale, top + 0.01, 1),
  };
}

export function getDetectionPixelCrop(
  bbox: NormalizedBoundingBox,
  sourceWidth: number,
  sourceHeight: number,
  paddingRatio = 0.12,
) {
  const normalized = normalizeDetectionBoundingBox(bbox);
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  const paddingX = (normalized.right - normalized.left) * paddingRatio;
  const paddingY = (normalized.bottom - normalized.top) * paddingRatio;
  const left = Math.max(0, Math.floor((normalized.left - paddingX) * width));
  const top = Math.max(0, Math.floor((normalized.top - paddingY) * height));
  const right = Math.min(width, Math.ceil((normalized.right + paddingX) * width));
  const bottom = Math.min(height, Math.ceil((normalized.bottom + paddingY) * height));
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

export function getDetectionPreviewLayout(
  bbox: NormalizedBoundingBox,
  sourceWidth: number,
  sourceHeight: number,
  maxSize = 76,
) {
  const { left, top, right, bottom } = normalizeDetectionBoundingBox(bbox);
  const boxWidth = right - left;
  const boxHeight = bottom - top;
  const aspectRatio = (boxWidth * Math.max(sourceWidth, 1)) / (boxHeight * Math.max(sourceHeight, 1));
  const frameWidth = aspectRatio >= 1 ? maxSize : maxSize * aspectRatio;
  const frameHeight = aspectRatio >= 1 ? maxSize / aspectRatio : maxSize;

  return {
    frame: { width: frameWidth, height: frameHeight },
    image: {
      width: `${100 / boxWidth}%`,
      height: `${100 / boxHeight}%`,
      left: `${(-left / boxWidth) * 100}%`,
      top: `${(-top / boxHeight) * 100}%`,
    },
  };
}
