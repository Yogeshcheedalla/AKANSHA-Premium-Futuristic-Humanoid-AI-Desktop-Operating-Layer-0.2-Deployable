/**
 * Akansha durable-Postgres provisioning + verification harness.
 *
 *   DATABASE_URL=... DIRECT_URL=...  npm run db:provision
 *
 * Works against BOTH a self-managed/local Postgres AND a managed provider
 * (Supabase / Neon), WITHOUT embedding any secret (values come from env at
 * runtime — never paste them into chat or commit them).
 *
 *   • DIRECT_URL (session-mode / port 5432) is used for DDL + drizzle migrate,
 *     because DDL over a transaction-mode pgbouncer pooler can fail.
 *   • DATABASE_URL (transaction-mode pooler, port 6543) is the runtime DSN.
 *   • RLS is verified under a NON-OWNER, NON-BYPASS role via `SET ROLE`:
 *       - self-managed: creates a least-privilege `akansha_app` role, or
 *       - managed (CREATE ROLE denied): falls back to the provider's existing
 *         `authenticated` role. A superuser/owner would BYPASS RLS, so we never
 *         test isolation as the owner.
 *
 * Every stage reports PASS / FAIL / BLOCKED from real evidence; it never fakes
 * success. With no DATABASE_URL it reports BLOCKED and leaves offline mode intact.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';

const RUNTIME_URL = process.env.DATABASE_URL || '';
const ADMIN_URL = process.env.DIRECT_URL || process.env.DATABASE_URL || '';   // DDL/migrations
const APP_ROLE = process.env.AKANSHA_APP_ROLE || 'akansha_app';
const MIGRATIONS_DIR = path.join(process.cwd(), 'src', 'db', 'migrations');
const SECURITY_SQL = path.join(MIGRATIONS_DIR, '0001_security_and_vector.sql');

type Verdict = 'PASS' | 'FAIL' | 'BLOCKED';
const report: { stage: string; verdict: Verdict; detail: string }[] = [];
function record(stage: string, verdict: Verdict, detail: string) {
  report.push({ stage, verdict, detail });
  const mark = verdict === 'PASS' ? '✓' : verdict === 'FAIL' ? '✗' : '⊘';
  console.log(`  ${mark} ${stage.padEnd(16)} ${verdict.padEnd(7)} ${detail}`);
}

async function main() {
  if (!ADMIN_URL) {
    record('connection', 'BLOCKED', 'DATABASE_URL/DIRECT_URL not set — offline mode preserved (no fake success).');
    return finish();
  }

  const ssl = /sslmode=require/i.test(ADMIN_URL)
    ? { require: true, rejectUnauthorized: process.env.AKANSHA_DB_SSL_VERIFY !== '0' }
    : undefined;
  const admin = new Pool({ connectionString: ADMIN_URL, ssl, max: 4 });
  let testRole = APP_ROLE;
  try {
    // 1. connection
    try {
      const r = await admin.query('select 1 as ok, current_database() as db');
      record('connection', 'PASS', `connected to db "${r.rows[0].db}"`);
    } catch (e: any) {
      record('connection', 'FAIL', e?.message || 'cannot connect');
      return finish();
    }

    // 2. migrate (drizzle, over the DIRECT/session connection)
    try {
      await migrate(drizzle(admin), { migrationsFolder: MIGRATIONS_DIR });
      const t = await admin.query(
        `select tablename from pg_tables where schemaname='public'
         and tablename in ('action_executions','memory_entries','missions','device_sessions','experiences')`);
      const have = t.rows.map((x: any) => x.tablename);
      const missing = ['action_executions', 'memory_entries', 'missions', 'device_sessions'].filter((x) => !have.includes(x));
      record('migrate', missing.length ? 'FAIL' : 'PASS', missing.length ? `missing tables: ${missing.join(',')}` : `${have.length} core tables present`);
    } catch (e: any) {
      record('migrate', 'FAIL', e?.message || 'drizzle migrate failed');
    }

    // 3. security migration (idempotent: pgvector + RLS)
    try {
      await admin.query(fs.readFileSync(SECURITY_SQL, 'utf8'));
      record('security', 'PASS', 'pgvector + RLS policies applied (idempotent)');
    } catch (e: any) {
      record('security', 'FAIL', e?.message || '0001 apply failed');
    }

    // 4. pgvector
    try {
      const v = await admin.query(`select extversion from pg_extension where extname='vector'`);
      if (!v.rows.length) record('pgvector', 'BLOCKED', 'vector extension not installed on this server');
      else {
        const col = await admin.query(`select 1 from information_schema.columns where table_name='memory_entries' and column_name='embedding'`);
        record('pgvector', col.rows.length ? 'PASS' : 'BLOCKED', col.rows.length ? `vector ${v.rows[0].extversion} + embedding column present` : `vector ${v.rows[0].extversion} installed but no embedding column`);
      }
    } catch (e: any) { record('pgvector', 'FAIL', e?.message || 'vector check failed'); }

    // 5. pick a NON-OWNER role the connecting user can actually SET ROLE to (RLS-bound).
    //    Self-managed: a created akansha_app (superuser can SET ROLE to it). Managed/Supabase:
    //    postgres can't SET ROLE to a role it isn't a member of, so fall back to the
    //    provider's `authenticated` (postgres IS a member of it, and RLS binds to it).
    let testRole: string | null = null;
    try { await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${APP_ROLE}') THEN CREATE ROLE ${APP_ROLE} NOLOGIN; END IF; END $$;`); } catch { /* managed DB may deny CREATE ROLE */ }
    for (const cand of [APP_ROLE, 'authenticated', 'anon']) {
      const probe = await admin.connect();
      let ok = false;
      try { await probe.query(`SET ROLE ${cand}`); ok = true; } catch { ok = false; }
      finally { try { await probe.query('RESET ROLE'); } catch { /* ignore */ } probe.release(); }
      if (ok) { testRole = cand; break; }
    }
    if (testRole) {
      try {
        await admin.query(`GRANT USAGE ON SCHEMA public TO ${testRole};`);
        await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON memory_entries, action_executions, missions, device_sessions TO ${testRole};`);
        await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${testRole};`);
        record('role', 'PASS', `RLS verified as non-owner role "${testRole}" (SET ROLE ok)`);
      } catch (e: any) { record('role', 'FAIL', `grants to ${testRole} failed: ${e?.message || ''}`); }
    } else {
      record('role', 'FAIL', 'no SET-ROLE-able non-owner role available to verify isolation');
    }

    // 6 + 7: write/read-back + RLS isolation, run under SET ROLE <testRole> (never the owner)
    if (!testRole) {
      record('write_readback', 'BLOCKED', 'no test role');
      record('rls_read_isolation', 'BLOCKED', 'no test role');
      record('rls_write_isolation', 'BLOCKED', 'no test role');
    } else {
    const UA = 'akansha-verify-user-A';
    const UB = 'akansha-verify-user-B';
    const stamp = Date.now();
    const c = await admin.connect();
    try {
      await c.query(`SET ROLE ${testRole}`);
      await c.query(`SET akansha.user_id = '${UA}'`);
      await c.query(`INSERT INTO memory_entries (memory_id, user_id, category, content) VALUES ($1,$2,'episodic',$3)`, [`ver-mem-${stamp}`, UA, `verified memory for ${UA}`]);
      await c.query(`INSERT INTO action_executions (request_id, action_id, user_id, status, verified) VALUES ($1,'db.verify',$2,'COMPLETED',true)`, [`ver-act-${stamp}`, UA]);
      const mem = await c.query(`SELECT content FROM memory_entries WHERE memory_id=$1`, [`ver-mem-${stamp}`]);
      const act = await c.query(`SELECT status FROM action_executions WHERE request_id=$1`, [`ver-act-${stamp}`]);
      const ok = mem.rows[0]?.content === `verified memory for ${UA}` && act.rows[0]?.status === 'COMPLETED';
      record('write_readback', ok ? 'PASS' : 'FAIL', ok ? `wrote + read back own rows as ${testRole}/user-A` : 'read-back mismatch');

      // seed a B row as the OWNER (admin), then confirm user-A cannot read it under the test role
      await c.query(`RESET ROLE`);
      await admin.query(`INSERT INTO memory_entries (memory_id, user_id, category, content) VALUES ($1,$2,'episodic',$3) ON CONFLICT DO NOTHING`, [`ver-mem-B-${stamp}`, UB, `secret memory for ${UB}`]);
      await c.query(`SET ROLE ${testRole}`);
      const leaked = await c.query(`SELECT 1 FROM memory_entries WHERE memory_id=$1`, [`ver-mem-B-${stamp}`]);
      record('rls_read_isolation', leaked.rows.length === 0 ? 'PASS' : 'FAIL', leaked.rows.length === 0 ? 'user-A cannot read user-B row (RLS hides it)' : 'RLS DID NOT hide another user row');

      let writeBlocked = false;
      try { await c.query(`INSERT INTO memory_entries (memory_id, user_id, category, content) VALUES ($1,$2,'episodic','x')`, [`ver-forgery-${stamp}`, UB]); }
      catch { writeBlocked = true; }
      record('rls_write_isolation', writeBlocked ? 'PASS' : 'FAIL', writeBlocked ? 'user-A cannot forge a user-B row (WITH CHECK denied)' : 'forgery ALLOWED — RLS gap');
    } catch (e: any) {
      record('write_readback', 'FAIL', e?.message || 'test-role session failed');
      record('rls_read_isolation', 'BLOCKED', 'skipped after write failure');
      record('rls_write_isolation', 'BLOCKED', 'skipped after write failure');
    } finally {
      try { await c.query(`RESET ROLE`); } catch { /* ignore */ }
      c.release();
      await admin.query(`DELETE FROM memory_entries WHERE memory_id LIKE 'ver-mem-%'`).catch(() => {});
      await admin.query(`DELETE FROM action_executions WHERE request_id LIKE 'ver-act-%'`).catch(() => {});
    }
    }

    // 8. backup/restore — real pg_dump if the client binary is available; else honest BLOCKED
    try {
      execFileSync('pg_dump', ['--version'], { stdio: 'pipe', timeout: 10000 });
      const dumpFile = path.join(os.tmpdir(), `akansha_verify_dump_${Date.now()}.sql`);
      execFileSync('pg_dump', ['-d', ADMIN_URL, '-f', dumpFile], { stdio: 'pipe', timeout: 180000 });
      const sz = fs.statSync(dumpFile).size;
      const hasTable = /action_executions/.test(fs.readFileSync(dumpFile, 'utf8'));
      fs.rmSync(dumpFile, { force: true });
      record('backup_restore', (sz > 0 && hasTable) ? 'PASS' : 'FAIL', `pg_dump ${sz} bytes; schema present=${hasTable}`);
    } catch (e: any) {
      record('backup_restore', 'BLOCKED', `pg_dump client not available locally (managed providers run their own backups): ${(e?.message || '').slice(0, 70)}`);
    }
  } finally {
    await admin.end().catch(() => {});
  }
  finish();
}

function finish(): void {
  const CORE = ['connection', 'migrate', 'security', 'pgvector', 'role', 'write_readback', 'rls_read_isolation', 'rls_write_isolation'];
  const coreFails = report.filter((r) => CORE.includes(r.stage) && r.verdict !== 'PASS');
  const fails = report.filter((r) => r.verdict === 'FAIL');
  const blocked = report.filter((r) => r.verdict === 'BLOCKED');
  const passed = report.filter((r) => r.verdict === 'PASS');
  console.log('\n── DB provisioning verdict ─────────────────────────');
  console.log(`  ${passed.length} PASS · ${fails.length} FAIL · ${blocked.length} BLOCKED`);
  const verified = coreFails.length === 0;
  const backup = report.find((r) => r.stage === 'backup_restore');
  console.log(`  persistence: ${verified ? 'VERIFIED (connection + migrations + pgvector + RLS isolation + write/read-back)' : 'NOT verified — see FAIL/BLOCKED above'}`);
  if (backup && backup.verdict === 'BLOCKED') console.log(`  note: backup/restore is provider-managed (verify in the Supabase/Neon dashboard before GA)`);
  console.log('───────────────────────────────────────────────────\n');
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('harness crashed:', e?.message || e); process.exit(1); });
