-- ════════════════════════════════════════════════════════════════════════════
-- One-time recovery migration: reassigns orphaned rows (user_id = NULL) to
-- a specific user by email.
--
-- Why this exists:
--   Before commit f47d8b8 (auth + user_id on every insert), the API routes
--   used Supabase's admin client which bypasses RLS. Inserts fell through to
--   the `user_id DEFAULT auth.uid()` default, but with the admin client
--   auth.uid() returns NULL. Every row created before that commit has
--   user_id = NULL. After f47d8b8, RLS hides them from every user.
--
-- Run this once per user that lost access. Idempotent (WHERE user_id IS NULL).
-- ════════════════════════════════════════════════════════════════════════════
-- Change the email below if you need to recover a different user.

UPDATE public.garments AS g
  SET user_id = (SELECT id FROM auth.users WHERE email = 'mrtoddles11@gmail.com' LIMIT 1)
  WHERE g.user_id IS NULL
     OR g.user_id = '00000000-0000-0000-0000-000000000000';

UPDATE public.wear_logs AS w
  SET user_id = (SELECT id FROM auth.users WHERE email = 'mrtoddles11@gmail.com' LIMIT 1)
  WHERE w.user_id IS NULL
     OR w.user_id = '00000000-0000-0000-0000-000000000000';

UPDATE public.saved_outfits AS s
  SET user_id = (SELECT id FROM auth.users WHERE email = 'mrtoddles11@gmail.com' LIMIT 1)
  WHERE s.user_id IS NULL
     OR s.user_id = '00000000-0000-0000-0000-000000000000';

UPDATE public.user_measurements AS m
  SET user_id = (SELECT id FROM auth.users WHERE email = 'mrtoddles11@gmail.com' LIMIT 1)
  WHERE m.user_id IS NULL
     OR m.user_id = '00000000-0000-0000-0000-000000000000';