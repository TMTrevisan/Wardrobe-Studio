-- Create measurements locker table
CREATE TABLE IF NOT EXISTS public.user_measurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label VARCHAR(255) NOT NULL, -- e.g., 'My Body Measurements', 'Favorite Oxford Shirt Fit'
    measurement_type VARCHAR(50) NOT NULL CHECK (measurement_type IN ('body', 'garment')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb, -- e.g., {"chest": "41", "waist": "32", "inseam": "30"}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.user_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read/write access for user measurements" 
ON public.user_measurements 
FOR ALL 
TO public 
USING (true) 
WITH CHECK (true);
