import type { Garment } from '@/types/db';

/**
 * Convert the closet into a CSV blob and trigger a download. Returns
 * the CSV string so callers can also pipe it elsewhere (clipboard,
 * server upload) without re-running the formatter.
 *
 * Quote-escapes per RFC 4180: every value is wrapped in `"…"` and
 * internal `"` is doubled.
 */
export function garmentsToCsv(
  items: Garment[],
  wornCount: (id: string) => number
): string {
  const headers = [
    'ID',
    'Brand',
    'Category',
    'Sub-Category',
    'Color Family',
    'Hex Code',
    'Tonal Value',
    'Fabric Blend',
    'Fit Block',
    'Sleeve / Detail',
    'Purchase Price',
    'Purchase Year',
    'Wears Count',
    'Notes',
  ];
  const rows = items.map((i) => [
    i.id,
    i.brand || '',
    i.category,
    i.sub_category,
    i.color_family,
    i.hex_code || '',
    i.tonal_value || '',
    i.fabric_type || '',
    i.fit_block || '',
    i.style_detail || '',
    i.price || 0,
    i.purchase_year || '',
    wornCount(i.id),
    i.notes || '',
  ]);

  const escape = (val: unknown) => `"${String(val).replace(/"/g, '""')}"`;
  return [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}

/**
 * Trigger a browser download of the CSV. No-op outside the browser.
 */
export function downloadCsv(csv: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const encoded = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  const link = document.createElement('a');
  link.href = encoded;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}