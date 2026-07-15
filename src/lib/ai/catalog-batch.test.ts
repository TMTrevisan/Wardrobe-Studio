import { describe, expect, it } from 'vitest';
import { runCatalogBatch } from './catalog-batch';

describe('runCatalogBatch', () => {
  it('limits concurrent image generations and reports progress', async () => {
    let active = 0;
    let maximumActive = 0;
    const progress: number[] = [];
    const ids = ['one', 'two', 'three', 'four'];

    const results = await runCatalogBatch(ids, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    }, {
      concurrency: 2,
      onProgress: (completed) => progress.push(completed),
    });

    expect(maximumActive).toBe(2);
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('keeps processing when one garment fails', async () => {
    const results = await runCatalogBatch(['good', 'bad', 'also-good'], async (id) => {
      if (id === 'bad') throw new Error('Model refused the source crop.');
    });

    expect(results).toEqual([
      { garmentId: 'good', ok: true },
      { garmentId: 'bad', ok: false, error: 'Model refused the source crop.' },
      { garmentId: 'also-good', ok: true },
    ]);
  });
});
