-- 1. Add user_id column to core tables referencing auth.users if not already exists
ALTER TABLE garments ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE saved_outfits ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE user_measurements ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE wear_logs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();

-- 2. Turn on Row Level Security (RLS) on all user data containers
ALTER TABLE garments ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_outfits ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE wear_logs ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS policies for Authenticated Users (Access checks)
CREATE POLICY "Users can only select their own garments" ON garments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can only insert their own garments" ON garments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can only update their own garments" ON garments FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can only delete their own garments" ON garments FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own saved_outfits" ON saved_outfits FOR ALL TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own measurements" ON user_measurements FOR ALL TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own wear_logs" ON wear_logs FOR ALL TO authenticated USING (auth.uid() = user_id);
