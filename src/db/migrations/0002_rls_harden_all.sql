-- 0002_rls_harden_all.sql
-- Close the Supabase security advisor finding `rls_disabled_in_public`: every
-- public table must have Row-Level Security enabled so the exposed anon /
-- authenticated API roles cannot read/write it.
--
-- SAFE BY DESIGN: the Akansha backend connects as the table OWNER (the `postgres`
-- role via DATABASE_URL). A table owner BYPASSES RLS unless it is FORCEd, so
-- merely ENABLEing RLS does NOT break the application's own reads/writes — it
-- only denies the public anon/authenticated roles (which have no policy). This is
-- exactly the remediation Supabase recommends for this advisor.
--
-- Idempotent: only touches tables that still have RLS off.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.relname);
    RAISE NOTICE 'RLS enabled on public.%', r.relname;
  END LOOP;
END $$;
