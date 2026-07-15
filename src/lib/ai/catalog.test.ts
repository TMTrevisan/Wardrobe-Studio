import { describe, expect, it } from 'vitest';
import { buildCatalogPrompt, chooseChromaKey } from './catalog';

describe('catalog prompt helpers', () => {
  it('chooses a chroma key far from the garment color', () => {
    expect(chooseChromaKey(['#00EE22'])).not.toBe('#00FF00');
    expect(chooseChromaKey(['#FF22DD'])).not.toBe('#FF00FF');
  });

  it('keeps the prompt evidence-bound', () => {
    const prompt = buildCatalogPrompt({
      name: 'navy shirt',
      category: 'Tops',
      color: 'navy',
      chromaKey: '#00FF00',
    });
    expect(prompt).toContain('Do not redesign');
    expect(prompt).toContain('#00FF00');
  });
});
