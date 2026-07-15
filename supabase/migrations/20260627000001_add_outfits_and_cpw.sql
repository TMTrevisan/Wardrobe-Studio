-- 1. Add price column to garments table
ALTER TABLE public.garments ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) DEFAULT 0.00;

-- 2. Create wear_logs table to track garment wear history (Cost-Per-Wear)
CREATE TABLE IF NOT EXISTS public.wear_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    garment_id UUID NOT NULL REFERENCES public.garments(id) ON DELETE CASCADE,
    worn_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wear_logs_garment ON public.wear_logs(garment_id);

-- 3. Create saved_outfits table to archive styling combinations
CREATE TABLE IF NOT EXISTS public.saved_outfits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    item_ids UUID[] NOT NULL,
    styling_reasoning TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.wear_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_outfits ENABLE ROW LEVEL SECURITY;

-- 5. Open access policies for development
CREATE POLICY "Allow public read wear_logs" ON public.wear_logs FOR SELECT USING (true);
CREATE POLICY "Allow public insert wear_logs" ON public.wear_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete wear_logs" ON public.wear_logs FOR DELETE USING (true);

CREATE POLICY "Allow public read saved_outfits" ON public.saved_outfits FOR SELECT USING (true);
CREATE POLICY "Allow public insert saved_outfits" ON public.saved_outfits FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete saved_outfits" ON public.saved_outfits FOR DELETE USING (true);
