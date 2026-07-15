import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';
import { STORAGE_BUCKET } from '@/lib/constants';

/**
 * GET /api/items/repair-orphan-images
 *
 * Scans Supabase storage for files in `raw/` that aren't referenced by
 * any `garment_images` row. The user can then attach them to a garment.
 *
 * Why this exists: pre-#1+#2, the upload route used the admin client and
 * uploaded files before the garment row existed. Some uploads never made
 * it into `garment_images` (network blip, dropped write, or the upload
 * happened before the multi-user migration). This endpoint finds them so
 * the user can repair by re-attaching.
 *
 * The filename pattern is `raw/{garmentId}-{idx}-{ts}.{ext}` — so we can
 * often infer the intended garment from the filename alone.
 */

interface OrphanFile {
  path: string;        // full storage path, e.g. "raw/abc-0-1234.jpg"
  publicUrl: string;   // for preview
  suggestedGarmentId: string | null; // parsed from filename
  fileName: string;
  size: number | null;
  createdAt: string | null;
}

interface OrphanListResponse {
  orphans: OrphanFile[];
  total: number;
}

export const GET = withUser(async ({ user }) => {
  try {
    // 1. List all files in storage under `raw/`.
    const { data: files, error: listErr } = await user.client.storage
      .from(STORAGE_BUCKET)
      .list('raw', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });

    if (listErr) {
      return fail(500, `Storage list failed: ${listErr.message}`);
    }
    if (!files || files.length === 0) {
      return ok<OrphanListResponse>({ orphans: [], total: 0 });
    }

    // 2. Build the set of storage paths already referenced by garment_images
    //    for THIS user. We join via garments so RLS narrows the result.
    const { data: imageRows } = await user.client
      .from('garment_images')
      .select('storage_path, garment_id, garment:garments!inner(user_id)')
      // We can't easily filter JSON in supabase-js, so we fetch the user's
      // image rows and dedupe in memory.
      .limit(2000);

    const referenced = new Set<string>();
    if (imageRows) {
      for (const row of imageRows as any[]) {
        if (row.storage_path) referenced.add(extractStoragePath(row.storage_path));
      }
    }

    // 3. Identify orphans: storage files in `raw/` not in `referenced`.
    const orphans: OrphanFile[] = [];
    for (const f of files) {
      const fullPath = `raw/${f.name}`;
      if (referenced.has(fullPath)) continue;

      // Filename pattern: {uuid}-{index}-{timestamp}.{ext}
      const stem = f.name.replace(/\.[^.]+$/, '');
      const parts = stem.split('-');
      const suggestedGarmentId = parts.length >= 6 ? `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}` : null;

      const { data: pub } = user.client.storage.from(STORAGE_BUCKET).getPublicUrl(fullPath);
      orphans.push({
        path: fullPath,
        publicUrl: pub.publicUrl,
        suggestedGarmentId,
        fileName: f.name,
        size: (f as any).metadata?.size ?? null,
        createdAt: (f as any).created_at ?? null,
      });
    }

    return ok<OrphanListResponse>({ orphans, total: orphans.length });
  } catch (err: any) {
    console.error('[repair-orphan-images] error', err);
    return fail(500, err.message || 'Failed to list orphans');
  }
});

/**
 * Helper: strip the storage base URL from a public storage_path so it
 * can be compared against the path produced by `list('raw/')`.
 */
function extractStoragePath(publicUrl: string): string {
  // publicPath looks like: https://<host>/storage/v1/object/public/wardrobe-images/raw/abc.jpg
  const idx = publicUrl.indexOf('/raw/');
  if (idx >= 0) return publicUrl.slice(idx + 1);
  return publicUrl;
}