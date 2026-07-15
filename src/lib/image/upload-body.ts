/**
 * Supabase Storage's server transport reliably treats a web File as binary.
 * Node Buffers and ArrayBuffers can otherwise be stringified by the storage
 * client, corrupting high-bit JPEG/PNG bytes before they reach Storage.
 */
export function toStorageFile(buffer: Buffer, filename: string, contentType: string): File {
  return new File([new Uint8Array(buffer)], filename, { type: contentType });
}
