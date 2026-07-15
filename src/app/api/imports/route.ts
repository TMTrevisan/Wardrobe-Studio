import { createHash, randomUUID } from 'node:crypto';
import { withUser, fail, ok } from '@/lib/api';

const MAX_FILES = 60;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SAFE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export const POST = withUser(async ({ user, request }) => {
  const formData = await request.formData();
  const source = String(formData.get('source') || 'device_picker');
  const allowedSources = ['manual', 'device_picker', 'local_folder', 'google_photos'];
  if (!allowedSources.includes(source)) return fail(400, 'Invalid import source.');

  const files = Array.from(formData.values()).filter((value): value is File => value instanceof File);
  if (files.length === 0) return fail(400, 'Choose at least one photo.');
  if (files.length > MAX_FILES) return fail(400, `Choose up to ${MAX_FILES} photos per import.`);

  const { data: importRow, error: importError } = await user.client
    .from('wardrobe_imports')
    .insert({
      user_id: user.id,
      source,
      name: String(formData.get('name') || `Photo import ${new Date().toLocaleDateString()}`),
      status: 'uploading',
      total_assets: files.length,
    })
    .select()
    .single();
  if (importError) return fail(500, `Create the Wardrobe Studio migration first: ${importError.message}`);

  const uploaded: Array<Record<string, unknown>> = [];
  for (const file of files) {
    if (!SAFE_TYPES.has(file.type)) return fail(400, `${file.name} is not a supported image.`);
    if (file.size > MAX_FILE_BYTES) return fail(400, `${file.name} is larger than 25 MB.`);

    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${user.id}/${importRow.id}/${randomUUID()}.${extension}`;
    const { error: storageError } = await user.client.storage
      .from('wardrobe-sources')
      .upload(path, bytes, { contentType: file.type, upsert: false });
    if (storageError) return fail(500, storageError.message);

    const { data: asset, error: assetError } = await user.client
      .from('source_assets')
      .insert({
        import_id: importRow.id,
        user_id: user.id,
        storage_path: path,
        original_filename: file.name,
        mime_type: file.type,
        byte_size: file.size,
        sha256,
      })
      .select()
      .single();
    if (assetError) {
      if (assetError.code === '23505') continue;
      return fail(500, assetError.message);
    }
    uploaded.push(asset);
  }

  await user.client.from('wardrobe_imports').update({
    status: 'queued',
    total_assets: uploaded.length,
    updated_at: new Date().toISOString(),
  }).eq('id', importRow.id);

  return ok({ importId: importRow.id, import: { ...importRow, status: 'queued', total_assets: uploaded.length }, assets: uploaded });
});

export const GET = withUser(async ({ user }) => {
  const { data, error } = await user.client
    .from('wardrobe_imports')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return fail(500, error.message);
  return ok({ imports: data || [] });
});
