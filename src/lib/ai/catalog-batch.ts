export type CatalogBatchResult = {
  garmentId: string;
  ok: boolean;
  error?: string;
};

type BatchOptions = {
  concurrency?: number;
  onProgress?: (completed: number, total: number, result: CatalogBatchResult) => void;
};

export async function runCatalogBatch(
  garmentIds: string[],
  generate: (garmentId: string) => Promise<void>,
  options: BatchOptions = {},
): Promise<CatalogBatchResult[]> {
  if (!garmentIds.length) return [];

  const results: CatalogBatchResult[] = new Array(garmentIds.length);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, garmentIds.length));
  let cursor = 0;
  let completed = 0;

  async function lane() {
    while (true) {
      const index = cursor++;
      if (index >= garmentIds.length) return;
      const garmentId = garmentIds[index];
      let result: CatalogBatchResult;
      try {
        await generate(garmentId);
        result = { garmentId, ok: true };
      } catch (error) {
        result = {
          garmentId,
          ok: false,
          error: error instanceof Error ? error.message : 'Catalog generation failed.',
        };
      }
      results[index] = result;
      completed += 1;
      options.onProgress?.(completed, garmentIds.length, result);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => lane()));
  return results;
}
