-- 1. Drop old image columns from public.garments table
ALTER TABLE public.garments DROP COLUMN IF EXISTS raw_image_url;
ALTER TABLE public.garments DROP COLUMN IF EXISTS processed_image_url;

-- 2. Create dedicated Multi-Media Asset Table
CREATE TABLE IF NOT EXISTS public.garment_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    garment_id UUID NOT NULL REFERENCES public.garments(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,                -- Public URL or storage path inside Supabase
    is_primary_profile BOOLEAN DEFAULT false,  -- Grid thumbnail designation
    asset_type VARCHAR(20) DEFAULT 'profile',  -- 'profile' or 'detail'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexing for fast foreign key retrieval
CREATE INDEX IF NOT EXISTS idx_garment_images_relation ON public.garment_images(garment_id);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.garment_images ENABLE ROW LEVEL SECURITY;

-- 4. Open access policies for development
CREATE POLICY "Allow public read garment_images" ON public.garment_images FOR SELECT USING (true);
CREATE POLICY "Allow public insert garment_images" ON public.garment_images FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update garment_images" ON public.garment_images FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete garment_images" ON public.garment_images FOR DELETE USING (true);
