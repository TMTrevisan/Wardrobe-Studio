-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Define Enums for Data Normalization
CREATE TYPE garment_category AS ENUM ('Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Tailoring');
CREATE TYPE garment_status AS ENUM ('Active', 'Archive', 'Donate', 'Discard', 'Processing', 'Processing_Failed');
CREATE TYPE tonal_value_enum AS ENUM ('Light', 'Medium', 'Dark');
CREATE TYPE token_service_enum AS ENUM ('Gemini_Vision_Ingest', 'Gemini_Stylist_Engine', 'Pirate_Weather_API');

-- 1. Garments Core Table
CREATE TABLE IF NOT EXISTS public.garments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid, -- Default user_id for single-user dev setup
    category garment_category NOT NULL,
    sub_category VARCHAR(50) NOT NULL,
    brand VARCHAR(100),
    color_family VARCHAR(50) NOT NULL,
    hex_code CHAR(7),
    tonal_value tonal_value_enum NOT NULL,
    fabric_type VARCHAR(50) NOT NULL,
    fit_block VARCHAR(50) NOT NULL,
    status garment_status DEFAULT 'Processing',
    raw_image_url TEXT NOT NULL,
    processed_image_url TEXT, -- For background-removed product shots
    ai_extracted_json JSONB, -- Retain raw inference payload for debugging
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexing for fast search, filtering, and styling lookups
CREATE INDEX IF NOT EXISTS idx_garments_user_status ON public.garments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_garments_filtering ON public.garments(category, color_family, fit_block);

-- 2. Pirate Weather Cache Table (Prevents API abuse and token leak)
CREATE TABLE IF NOT EXISTS public.weather_cache (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    geohash VARCHAR(12) NOT NULL, -- Cached by regional spatial blocks
    weather_data JSONB NOT NULL,
    weather_string TEXT, -- Unified descriptive string representation
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_weather_cache_geohash ON public.weather_cache(geohash);

-- 3. Token Consumption & API Cost Ledger
CREATE TABLE IF NOT EXISTS public.billing_and_token_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    service token_service_enum NOT NULL,
    tokens_in INT DEFAULT 0,
    tokens_out INT DEFAULT 0,
    estimated_cost NUMERIC(8, 6) DEFAULT 0.000000,
    metadata JSONB -- Stores route, response status, or batch sizes
);
CREATE INDEX IF NOT EXISTS idx_ledger_service_timestamp ON public.billing_and_token_ledger(service, timestamp);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.garments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weather_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_and_token_ledger ENABLE ROW LEVEL SECURITY;

-- 5. Open access policies for development
CREATE POLICY "Allow public read garments" ON public.garments FOR SELECT USING (true);
CREATE POLICY "Allow public insert garments" ON public.garments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update garments" ON public.garments FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete garments" ON public.garments FOR DELETE USING (true);

CREATE POLICY "Allow public read weather_cache" ON public.weather_cache FOR SELECT USING (true);
CREATE POLICY "Allow public insert weather_cache" ON public.weather_cache FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read ledger" ON public.billing_and_token_ledger FOR SELECT USING (true);
CREATE POLICY "Allow public insert ledger" ON public.billing_and_token_ledger FOR INSERT WITH CHECK (true);
