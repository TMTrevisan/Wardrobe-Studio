-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  DEPRECATED — DO NOT USE
-- ════════════════════════════════════════════════════════════════════════════
-- This file describes the original `wardrobe_items` table from an earlier
-- version of Antigravity Threads. The application has since migrated to the
-- `garments` table defined by `migration_multiuser.sql`.
--
-- The RLS policies here are FULLY PERMISSIVE (USING (true)) and the storage
-- bucket described below is configured as PUBLIC. Running this file as-is
-- would expose all wardrobe photos and metadata to anonymous users.
--
-- If you are setting up a fresh environment, run `migration_multiuser.sql`
-- instead (and add migrations for `garment_images`, `saved_outfits`,
-- `wear_logs`, `user_measurements`, `billing_and_token_ledger`,
-- `weather_cache` — those are not yet captured in any migration file).
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Create the wardrobe_items table (LEGACY — superseded by `garments`)
CREATE TABLE IF NOT EXISTS public.wardrobe_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_url TEXT NOT NULL,
    category TEXT NOT NULL,
    sub_category TEXT NOT NULL,
    brand TEXT,
    color_family TEXT NOT NULL,
    color_hex TEXT, -- Enhancement: hex code for UI swatches
    tonal_value TEXT,
    fabric_type TEXT,
    fit_block TEXT,
    status TEXT DEFAULT 'Active', -- 'Active', 'Donate', 'Sell'
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.wardrobe_items ENABLE ROW LEVEL SECURITY;

-- 3. Create simple open access policies (for development/personal use)
-- Note: In a production shared environment, you'd restrict this to authenticated users.
CREATE POLICY "Allow public read access" 
ON public.wardrobe_items 
FOR SELECT 
USING (true);

CREATE POLICY "Allow public insert access" 
ON public.wardrobe_items 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public update access" 
ON public.wardrobe_items 
FOR UPDATE 
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow public delete access" 
ON public.wardrobe_items 
FOR DELETE 
USING (true);

/*
======================================================================
SUPABASE STORAGE BUCKET SETUP INSTRUCTIONS:
======================================================================
You need to create a storage bucket in Supabase for the wardrobe photos:

1. Go to the Supabase Dashboard -> Storage.
2. Click "New bucket".
3. Name it: "wardrobe-images"
4. Make sure to toggle on "Public bucket" (this allows anyone to view the images via URL).
5. Set up Bucket Policies (Allowed operations):
   - Under "Policies for wardrobe-images", create a policy allowing public uploads (INSERT) and reads (SELECT).
   - Alternatively, choose "Allowed to upload for everyone" and "Allowed to read for everyone" for quick personal project setup.
======================================================================
*/
