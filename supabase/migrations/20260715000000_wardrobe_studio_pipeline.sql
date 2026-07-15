-- Wardrobe Studio: additive camera-roll ingestion and catalog generation schema.
-- This migration keeps the existing garments, garment_images, wear_logs, and
-- saved_outfits tables intact while introducing source provenance and durable
-- processing state.

create extension if not exists pgcrypto;

-- Some existing Antigravity projects use a varchar category column while
-- fresh local installs use the garment_category enum. Extend the enum only
-- when it exists so the additive migration supports both live schemas.
do $$
begin
  if exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'garment_category'
  ) then
    execute 'alter type public.garment_category add value if not exists ''Accessories''';
    execute 'alter type public.garment_category add value if not exists ''Dresses''';
  end if;
end $$;

alter table public.garments
  add column if not exists display_name text,
  add column if not exists pattern text,
  add column if not exists season text[] not null default '{}',
  add column if not exists formality text,
  add column if not exists size_label text,
  add column if not exists catalog_status text not null default 'not_started'
    check (catalog_status in ('not_started', 'queued', 'generating', 'ready', 'needs_review', 'failed')),
  add column if not exists metadata_confidence numeric(4,3)
    check (metadata_confidence is null or metadata_confidence between 0 and 1);

alter table public.saved_outfits
  add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();

alter table public.wear_logs
  add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();

alter table public.user_measurements
  add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();

create table if not exists public.wardrobe_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  source text not null check (source in ('manual', 'device_picker', 'local_folder', 'google_photos')),
  name text,
  status text not null default 'uploading'
    check (status in ('uploading', 'queued', 'scanning', 'review', 'complete', 'failed', 'cancelled')),
  total_assets integer not null default 0,
  processed_assets integer not null default 0,
  detected_items integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.source_assets (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.wardrobe_imports(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  bucket text not null default 'wardrobe-sources',
  storage_path text not null,
  source_provider_id text,
  original_filename text,
  mime_type text not null,
  byte_size bigint,
  width integer,
  height integer,
  captured_at timestamptz,
  sha256 text,
  perceptual_hash text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'queued', 'analyzing', 'analyzed', 'failed', 'skipped')),
  analysis_json jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, sha256)
);

create table if not exists public.garment_detections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  source_asset_id uuid not null references public.source_assets(id) on delete cascade,
  garment_id uuid references public.garments(id) on delete set null,
  candidate_group_key text,
  category text not null,
  sub_category text,
  description text,
  bbox jsonb not null,
  confidence numeric(4,3) not null default 0.5 check (confidence between 0 and 1),
  colors jsonb not null default '[]'::jsonb,
  observed_details jsonb not null default '{}'::jsonb,
  duplicate_candidates jsonb not null default '[]'::jsonb,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'merged', 'rejected', 'held')),
  created_at timestamptz not null default now()
);

create table if not exists public.garment_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  garment_id uuid not null references public.garments(id) on delete cascade,
  source_asset_id uuid references public.source_assets(id) on delete set null,
  kind text not null check (kind in (
    'source_crop', 'catalog_chroma', 'catalog_cutout', 'detail',
    'person_reference', 'outfit_render'
  )),
  bucket text not null,
  storage_path text not null,
  mime_type text not null default 'image/png',
  width integer,
  height integer,
  chroma_key char(7),
  prompt text,
  model text,
  is_primary boolean not null default false,
  qa_status text not null default 'pending'
    check (qa_status in ('pending', 'passed', 'needs_review', 'rejected')),
  qa_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists garment_assets_one_primary_catalog
  on public.garment_assets (garment_id)
  where is_primary and kind = 'catalog_cutout';

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  import_id uuid references public.wardrobe_imports(id) on delete cascade,
  garment_id uuid references public.garments(id) on delete cascade,
  source_asset_id uuid references public.source_assets(id) on delete cascade,
  job_type text not null check (job_type in (
    'scan_photo', 'deduplicate', 'generate_catalog', 'remove_chroma',
    'render_outfit', 'technical_qa'
  )),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress numeric(5,2) not null default 0 check (progress between 0 and 100),
  attempt integer not null default 0,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error_message text,
  model text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.garment_tags (
  garment_id uuid not null references public.garments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  tag text not null,
  source text not null default 'user' check (source in ('user', 'ai')),
  created_at timestamptz not null default now(),
  primary key (garment_id, tag)
);

create table if not exists public.person_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null default 'Me',
  source_asset_id uuid references public.source_assets(id) on delete set null,
  bucket text,
  storage_path text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.outfit_items (
  outfit_id uuid not null references public.saved_outfits(id) on delete cascade,
  garment_id uuid not null references public.garments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  position integer not null default 0,
  role text,
  primary key (outfit_id, garment_id)
);

create table if not exists public.outfit_renders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  outfit_id uuid not null references public.saved_outfits(id) on delete cascade,
  person_profile_id uuid references public.person_profiles(id) on delete set null,
  bucket text not null,
  storage_path text not null,
  prompt text,
  model text,
  status text not null default 'queued'
    check (status in ('queued', 'generating', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists source_assets_import_idx on public.source_assets(import_id, status);
create index if not exists wardrobe_imports_user_idx on public.wardrobe_imports(user_id, created_at desc);
create index if not exists source_assets_user_idx on public.source_assets(user_id);
create index if not exists garment_detections_review_idx on public.garment_detections(user_id, review_status);
create index if not exists garment_detections_source_idx on public.garment_detections(source_asset_id);
create index if not exists garment_detections_garment_idx on public.garment_detections(garment_id) where garment_id is not null;
create index if not exists garment_assets_garment_idx on public.garment_assets(garment_id, kind);
create index if not exists garment_assets_user_idx on public.garment_assets(user_id);
create index if not exists garment_assets_source_idx on public.garment_assets(source_asset_id) where source_asset_id is not null;
create index if not exists processing_jobs_status_idx on public.processing_jobs(user_id, status, created_at);
create index if not exists processing_jobs_import_idx on public.processing_jobs(import_id) where import_id is not null;
create index if not exists processing_jobs_garment_idx on public.processing_jobs(garment_id) where garment_id is not null;
create index if not exists processing_jobs_source_idx on public.processing_jobs(source_asset_id) where source_asset_id is not null;
create index if not exists garment_tags_user_idx on public.garment_tags(user_id);
create index if not exists person_profiles_user_idx on public.person_profiles(user_id);
create index if not exists person_profiles_source_idx on public.person_profiles(source_asset_id) where source_asset_id is not null;
create index if not exists outfit_items_user_idx on public.outfit_items(user_id);
create index if not exists outfit_items_garment_idx on public.outfit_items(garment_id);
create index if not exists outfit_renders_user_idx on public.outfit_renders(user_id);
create index if not exists outfit_renders_outfit_idx on public.outfit_renders(outfit_id);
create index if not exists outfit_renders_person_idx on public.outfit_renders(person_profile_id) where person_profile_id is not null;
create index if not exists wear_logs_user_idx on public.wear_logs(user_id);
create index if not exists saved_outfits_user_idx on public.saved_outfits(user_id);
create index if not exists user_measurements_user_idx on public.user_measurements(user_id);

alter table public.wardrobe_imports enable row level security;
alter table public.source_assets enable row level security;
alter table public.garment_detections enable row level security;
alter table public.garment_assets enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.garment_tags enable row level security;
alter table public.person_profiles enable row level security;
alter table public.outfit_items enable row level security;
alter table public.outfit_renders enable row level security;

-- Remove the permissive development policies that otherwise OR with ownership policies.
drop policy if exists "Allow public read garments" on public.garments;
drop policy if exists "Allow public insert garments" on public.garments;
drop policy if exists "Allow public update garments" on public.garments;
drop policy if exists "Allow public delete garments" on public.garments;
drop policy if exists "Allow public read/write garments" on public.garments;
drop policy if exists "Allow public read garment_images" on public.garment_images;
drop policy if exists "Allow public insert garment_images" on public.garment_images;
drop policy if exists "Allow public update garment_images" on public.garment_images;
drop policy if exists "Allow public delete garment_images" on public.garment_images;
drop policy if exists "Allow public read wear_logs" on public.wear_logs;
drop policy if exists "Allow public insert wear_logs" on public.wear_logs;
drop policy if exists "Allow public delete wear_logs" on public.wear_logs;
drop policy if exists "Allow public read saved_outfits" on public.saved_outfits;
drop policy if exists "Allow public insert saved_outfits" on public.saved_outfits;
drop policy if exists "Allow public delete saved_outfits" on public.saved_outfits;
drop policy if exists "Allow public read/write access for user measurements" on public.user_measurements;
drop policy if exists "Users can only delete their own garments" on public.garments;
drop policy if exists "Users can only insert their own garments" on public.garments;
drop policy if exists "Users can only select their own garments" on public.garments;
drop policy if exists "Users can only update their own garments" on public.garments;
drop policy if exists "Users can manage their own saved_outfits" on public.saved_outfits;
drop policy if exists "Users can manage their own measurements" on public.user_measurements;
drop policy if exists "Users can manage their own wear_logs" on public.wear_logs;

-- Ownership policies. Recreate by name so this migration is repeatable in dev.
drop policy if exists "wardrobe_imports_owner" on public.wardrobe_imports;
create policy "wardrobe_imports_owner" on public.wardrobe_imports for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "source_assets_owner" on public.source_assets;
create policy "source_assets_owner" on public.source_assets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "garment_detections_owner" on public.garment_detections;
create policy "garment_detections_owner" on public.garment_detections for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "garment_assets_owner" on public.garment_assets;
create policy "garment_assets_owner" on public.garment_assets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "processing_jobs_owner" on public.processing_jobs;
create policy "processing_jobs_owner" on public.processing_jobs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "garment_tags_owner" on public.garment_tags;
create policy "garment_tags_owner" on public.garment_tags for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "person_profiles_owner" on public.person_profiles;
create policy "person_profiles_owner" on public.person_profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "outfit_items_owner" on public.outfit_items;
create policy "outfit_items_owner" on public.outfit_items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "outfit_renders_owner" on public.outfit_renders;
create policy "outfit_renders_owner" on public.outfit_renders for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "garments_owner" on public.garments;
create policy "garments_owner" on public.garments for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "garment_images_owner" on public.garment_images;
create policy "garment_images_owner" on public.garment_images for all to authenticated
  using (exists (
    select 1 from public.garments g
    where g.id = garment_images.garment_id and g.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.garments g
    where g.id = garment_images.garment_id and g.user_id = (select auth.uid())
  ));

drop policy if exists "wear_logs_owner" on public.wear_logs;
create policy "wear_logs_owner" on public.wear_logs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "saved_outfits_owner" on public.saved_outfits;
create policy "saved_outfits_owner" on public.saved_outfits for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "user_measurements_owner" on public.user_measurements;
create policy "user_measurements_owner" on public.user_measurements for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public)
values ('wardrobe-sources', 'wardrobe-sources', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('wardrobe-catalog', 'wardrobe-catalog', false)
on conflict (id) do update set public = false;

drop policy if exists "wardrobe_sources_owner" on storage.objects;
create policy "wardrobe_sources_owner" on storage.objects for all to authenticated
  using (
    bucket_id = 'wardrobe-sources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'wardrobe-sources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "wardrobe_catalog_owner" on storage.objects;
create policy "wardrobe_catalog_owner" on storage.objects for all to authenticated
  using (
    bucket_id = 'wardrobe-catalog'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'wardrobe-catalog'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
