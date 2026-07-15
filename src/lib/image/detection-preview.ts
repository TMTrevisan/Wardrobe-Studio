export type NormalizedBoundingBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function getDetectionPreviewLayout(
  bbox: NormalizedBoundingBox,
  sourceWidth: number,
  sourceHeight: number,
  maxSize = 76,
) {
  const left = clamp(Number(bbox.left) || 0, 0, 0.99);
  const top = clamp(Number(bbox.top) || 0, 0, 0.99);
  const right = clamp(Number(bbox.right) || 1, left + 0.01, 1);
  const bottom = clamp(Number(bbox.bottom) || 1, top + 0.01, 1);
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
