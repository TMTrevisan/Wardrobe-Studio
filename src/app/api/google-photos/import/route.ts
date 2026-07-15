import { createHash, randomUUID } from 'node:crypto';
import { withUser, fail, ok } from '@/lib/api';

type PickedItem = {
  id: string;
  mediaFile?: {
    baseUrl?: string;
    mimeType?: string;
    filename?: string;
    mediaFileMetadata?: { width?: string; height?: string };
  };
};

export const maxDuration = 300;

export const POST = withUser(async ({ user, request }) => {
  const { googleAccessToken, sessionId } = await request.json();
  if (!googleAccessToken || !sessionId) return fail(400, 'Google access token and sessionId are required.');

  const picked: PickedItem[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ sessionId, pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`https://photospicker.googleapis.com/v1/mediaItems?${params}`, {
      headers: { Authorization: `Bearer ${googleAccessToken}` },
    });
    const payload = await response.json();
    if (!response.ok) return fail(response.status, payload?.error?.message || 'Could not list selected Google Photos.');
    picked.push(...(payload.mediaItems || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken && picked.length < 2000);

  const photos = picked.filter((item) => item.mediaFile?.baseUrl && item.mediaFile?.mimeType?.startsWith('image/'));
  if (!photos.length) return fail(400, 'No still photos were selected.');

  const { data: importRow, error: importError } = await user.client.from('wardrobe_imports').insert({
    user_id: user.id,
    source: 'google_photos',
    name: `Google Photos · ${new Date().toLocaleDateString()}`,
    status: 'uploading',
    total_assets: photos.length,
  }).select().single();
  if (importError) return fail(500, importError.message);

  let uploaded = 0;
  for (const item of photos) {
    const media = item.mediaFile!;
    const response = await fetch(`${media.baseUrl}=d`, {
      headers: { Authorization: `Bearer ${googleAccessToken}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const filename = media.filename || `${item.id}.jpg`;
    const extension = filename.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${user.id}/${importRow.id}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await user.client.storage.from('wardrobe-sources').upload(path, bytes, {
      contentType: media.mimeType || 'image/jpeg',
      upsert: false,
    });
    if (uploadError) continue;

    const { error: assetError } = await user.client.from('source_assets').insert({
      import_id: importRow.id,
      user_id: user.id,
      storage_path: path,
      source_provider_id: item.id,
      original_filename: filename,
      mime_type: media.mimeType || 'image/jpeg',
      byte_size: bytes.length,
      width: Number(media.mediaFileMetadata?.width) || null,
      height: Number(media.mediaFileMetadata?.height) || null,
      sha256,
    });
    if (!assetError) uploaded += 1;
  }

  await user.client.from('wardrobe_imports').update({
    status: uploaded ? 'queued' : 'failed',
    total_assets: uploaded,
    error_message: uploaded ? null : 'Selected photos could not be downloaded.',
    updated_at: new Date().toISOString(),
  }).eq('id', importRow.id);

  return ok({ importId: importRow.id, uploaded, selected: photos.length });
});
