// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { garmentsToCsv, downloadCsv } from './csv';
import type { Garment } from '@/types/db';

const garment: Garment = {
  id: 'g1',
  category: 'Tops',
  sub_category: 'T-Shirt',
  brand: 'Acme',
  color_family: 'Olive',
  hex_code: '#556b2f',
  tonal_value: 'Medium',
  fabric_type: 'Cotton',
  fit_block: 'Regular',
  style_detail: null,
  status: 'Active',
  images: [],
  primary_image_url: null,
  notes: null,
  price: 60,
  purchase_year: 2023,
  created_at: '2026-01-01T00:00:00Z',
};

describe('garmentsToCsv()', () => {
  it('includes the column headers (quoted per RFC 4180)', () => {
    const csv = garmentsToCsv([], () => 0);
    expect(csv.split('\n')[0]).toContain('"ID","Brand","Category","Sub-Category","Color Family"');
  });

  it('renders one row per garment', () => {
    const items = [garment, { ...garment, id: 'g2', brand: 'Beta' }];
    const csv = garmentsToCsv(items, () => 0);
    const rows = csv.split('\n');
    expect(rows).toHaveLength(1 + items.length);
  });

  it('quote-escapes fields containing commas or quotes', () => {
    const tricky = { ...garment, notes: 'has, comma and "quote"' };
    const csv = garmentsToCsv([tricky], () => 0);
    expect(csv).toContain('"has, comma and ""quote"""');
  });

  it('substitutes wornCount via the callback', () => {
    const counts = new Map([['g1', 5]]);
    const csv = garmentsToCsv([garment], (id) => counts.get(id) ?? 0);
    expect(csv).toContain('"5"');
  });

  it('handles null/undefined optional fields as empty strings', () => {
    const bare = { ...garment, brand: null, hex_code: null, notes: null };
    const csv = garmentsToCsv([bare], () => 0);
    const fields = csv.split('\n')[1].split('","');
    expect(fields[1]).toBe(''); // brand
    expect(fields[5]).toBe(''); // hex
  });
});

describe('downloadCsv()', () => {
  it('is a no-op outside the browser', () => {
    // vitest default env is `node`; document is undefined here.
    expect(() => downloadCsv('a,b\n1,2', 'x.csv')).not.toThrow();
  });

  it('triggers a download via DOM when in the browser', () => {
    const append = vi.fn();
    const remove = vi.fn();
    const click = vi.fn();
    // jsdom supplies document; we just spy on the relevant pieces.
    const realCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        el.click = click;
      }
      return el;
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      append(node);
      return node;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => {
      remove(node);
      return node;
    });

    downloadCsv('a,b\n1,2', 'closet.csv');

    expect(createSpy).toHaveBeenCalledWith('a');
    expect(click).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();

    createSpy.mockRestore();
  });
});