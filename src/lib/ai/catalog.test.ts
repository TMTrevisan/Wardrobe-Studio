import { describe, expect, it } from 'vitest';
import { buildCatalogPrompt, chooseChromaKey, getCatalogQuality, getCatalogSize } from './catalog';

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

  it('uses cost-conscious catalog defaults and only accepts valid GPT Image 2 sizes', () => {
    expect(getCatalogQuality()).toBe('low');
    expect(getCatalogSize()).toBe('816x816');
    expect(getCatalogSize('816x816')).toBe('816x816');
    expect(getCatalogSize('512x512')).toBe('816x816');
    expect(getCatalogSize('1024x1024')).toBe('1024x1024');
  });
});
