-- Keep the legacy wardrobe-images bucket private while allowing each signed-in
-- owner to create signed URLs for image rows attached to their garments.

drop policy if exists "wardrobe_images_owner_read" on storage.objects;

create policy "wardrobe_images_owner_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'wardrobe-images'
  and exists (
    select 1
    from public.garment_images gi
    join public.garments g on g.id = gi.garment_id
    where g.user_id = (select auth.uid())
      and gi.storage_path like '%/storage/v1/object/public/wardrobe-images/' || storage.objects.name
  )
);
