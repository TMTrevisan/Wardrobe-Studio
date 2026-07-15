-- Enable RLS on garments table
ALTER TABLE public.garments ENABLE ROW LEVEL SECURITY;

-- Allow public read/write access (development configuration)
DROP POLICY IF EXISTS "Allow public read/write garments" ON public.garments;
CREATE POLICY "Allow public read/write garments" ON public.garments FOR ALL TO public USING (true) WITH CHECK (true);
