import { describe, expect, it } from 'vitest';
import { toStorageFile } from './upload-body';

describe('toStorageFile', () => {
  it('preserves binary JPEG bytes without UTF-8 coercion', async () => {
    const jpegPrefix = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const file = toStorageFile(jpegPrefix, 'crop.jpg', 'image/jpeg');

    expect(Buffer.from(await file.arrayBuffer())).toEqual(jpegPrefix);
    expect(file.type).toBe('image/jpeg');
  });

  it('respects a Buffer view offset and length', async () => {
    const source = Buffer.from([0x00, 0xff, 0xd8, 0xff, 0xd9, 0x00]);
    const view = source.subarray(1, 5);
    const file = toStorageFile(view, 'crop.jpg', 'image/jpeg');

    expect(Buffer.from(await file.arrayBuffer())).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });
});
