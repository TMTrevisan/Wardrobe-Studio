import { describe, expect, it } from 'vitest';
import { toStorageArrayBuffer } from './upload-body';

describe('toStorageArrayBuffer', () => {
  it('preserves binary JPEG bytes without UTF-8 coercion', () => {
    const jpegPrefix = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    expect(Buffer.from(toStorageArrayBuffer(jpegPrefix))).toEqual(jpegPrefix);
  });

  it('respects a Buffer view offset and length', () => {
    const source = Buffer.from([0x00, 0xff, 0xd8, 0xff, 0xd9, 0x00]);
    const view = source.subarray(1, 5);

    expect(Buffer.from(toStorageArrayBuffer(view))).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });
});
