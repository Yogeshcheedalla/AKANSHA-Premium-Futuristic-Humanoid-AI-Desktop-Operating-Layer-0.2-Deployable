-- 0001 — Security + semantic-memory groundwork (idempotent; safe to re-run).
-- Applied after the drizzle-generated 0000 schema migration.
-- Expresses things drizzle cannot: per-user ROW LEVEL SECURITY and pgvector.
-- The durable Postgres is the source of truth ONLY when these policies are active;
-- local SQLite/in-memory remains an offline cache, never the authority.

-- ── pgvector (semantic memory). Skipped with a NOTICE on images that lack it. ──
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector unavailable (%): skipping embedding columns', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER TABLE "memory_entries"  ADD COLUMN IF NOT EXISTS embedding vector(1536);
    ALTER TABLE "memory_records"  ADD COLUMN IF NOT EXISTS embedding vector(1536);
    CREATE INDEX IF NOT EXISTS memory_entries_embedding_idx  ON "memory_entries"  USING hnsw (embedding vector_cosine_ops);
    CREATE INDEX IF NOT EXISTS memory_records_embedding_idx  ON "memory_records"  USING hnsw (embedding vector_cosine_ops);
  ELSE
    RAISE NOTICE 'pgvector not installed — embedding columns not added';
  END IF;
END $$;

-- ── Row Level Security: strict per-user isolation on user-owned tables ──
-- The app MUST set, per connection/transaction:  SET akansha.user_id = '<google sub>';
-- current_setting(..., true) returns NULL when unset, so no other user's rows are visible.

ALTER TABLE "memory_entries"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory_entries"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "action_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "action_executions" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "missions"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "missions"          FORCE  ROW LEVEL SECURITY;
ALTER TABLE "device_sessions"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_sessions"   FORCE  ROW LEVEL SECURITY;

-- memory_entries (nullable user_id = system/global)
DROP POLICY IF EXISTS user_isolation_memory_entries ON "memory_entries";
CREATE POLICY user_isolation_memory_entries ON "memory_entries"
  USING       (user_id IS NULL OR user_id = current_setting('akansha.user_id', true))
  WITH CHECK  (user_id IS NULL OR user_id = current_setting('akansha.user_id', true));

-- action_executions
DROP POLICY IF EXISTS user_isolation_action_executions ON "action_executions";
CREATE POLICY user_isolation_action_executions ON "action_executions"
  USING       (user_id IS NULL OR user_id = current_setting('akansha.user_id', true))
  WITH CHECK  (user_id IS NULL OR user_id = current_setting('akansha.user_id', true));

-- missions
DROP POLICY IF EXISTS user_isolation_missions ON "missions";
CREATE POLICY user_isolation_missions ON "missions"
  USING       (user_id IS NULL OR user_id = current_setting('akansha.user_id', true))
  WITH CHECK  (user_id IS NULL OR user_id = current_setting('akansha.user_id', true));

-- device_sessions (user_id NOT NULL — no global rows)
DROP POLICY IF EXISTS user_isolation_device_sessions ON "device_sessions";
CREATE POLICY user_isolation_device_sessions ON "device_sessions"
  USING       (user_id = current_setting('akansha.user_id', true))
  WITH CHECK  (user_id = current_setting('akansha.user_id', true));

-- experiences has no user column (single-user cognitive store) — keep it owner-only,
-- deny the app role any access below via GRANT (no policy needed).
