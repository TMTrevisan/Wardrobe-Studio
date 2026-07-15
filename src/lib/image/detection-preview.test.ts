import { describe, expect, it } from 'vitest';
import { getDetectionPixelCrop, getDetectionPreviewLayout, normalizeDetectionBoundingBox } from './detection-preview';

describe('getDetectionPreviewLayout', () => {
  it('positions a normalized crop inside the preview frame', () => {
    const layout = getDetectionPreviewLayout(
      { left: 0.25, top: 0.1, right: 0.75, bottom: 0.9 },
      1000,
      2000,
      80,
    );

    expect(layout.frame).toEqual({ width: 25, height: 80 });
    expect(layout.image).toEqual({
      width: '200%',
      height: '125%',
      left: '-50%',
      top: '-12.5%',
    });
  });

  it('clamps invalid model coordinates to a usable crop', () => {
    const layout = getDetectionPreviewLayout(
      { left: -1, top: -1, right: 4, bottom: 4 },
      1200,
      800,
    );

    expect(layout.frame.width).toBe(76);
    expect(layout.frame.height).toBeCloseTo(50.666, 2);
    expect(layout.image.left).toBe('0%');
    expect(layout.image.top).toBe('0%');
  });
});

describe('Gemini bounding-box compatibility', () => {
  it('normalizes native 0–1000 coordinates', () => {
    expect(normalizeDetectionBoundingBox({ left: 272, top: 271, right: 498, bottom: 566 }))
      .toEqual({ left: 0.272, top: 0.271, right: 0.498, bottom: 0.566 });
  });

  it('creates a valid padded crop from native coordinates', () => {
    expect(getDetectionPixelCrop(
      { left: 272, top: 271, right: 498, bottom: 566 },
      1000,
      1000,
    )).toEqual({ left: 244, top: 235, width: 282, height: 367 });
  });
});
