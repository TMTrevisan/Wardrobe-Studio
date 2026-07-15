/**
 * Supabase Storage accepts ArrayBuffer, but passing a Node Buffer through its
 * server runtime can coerce high-bit image bytes into UTF-8 replacement
 * characters. Slice the exact backing bytes so JPEG/PNG payloads stay binary.
 */
export function toStorageArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}
