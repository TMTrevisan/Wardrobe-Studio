-- Remove legacy policies that overlap the consolidated owner policies added
-- by Wardrobe Studio. Keeping both is secure but causes every policy to be
-- evaluated and leaves older UPDATE policies without WITH CHECK protection.

drop policy if exists "Users can only delete their own garments" on public.garments;
drop policy if exists "Users can only insert their own garments" on public.garments;
drop policy if exists "Users can only select their own garments" on public.garments;
drop policy if exists "Users can only update their own garments" on public.garments;
drop policy if exists "Users can manage their own saved_outfits" on public.saved_outfits;
drop policy if exists "Users can manage their own measurements" on public.user_measurements;
drop policy if exists "Users can manage their own wear_logs" on public.wear_logs;

-- The previous single-user prototype bucket allowed anonymous listing,
-- uploads, and deletion. Wardrobe Studio writes new private assets to its
-- user-scoped buckets, so remove those broad legacy object policies.
drop policy if exists "Allow public read wardrobe-images" on storage.objects;
drop policy if exists "Allow public insert wardrobe-images" on storage.objects;
drop policy if exists "Allow public delete wardrobe-images" on storage.objects;

update storage.buckets set public = false where id = 'wardrobe-images';

create index if not exists garment_assets_user_idx on public.garment_assets(user_id);
