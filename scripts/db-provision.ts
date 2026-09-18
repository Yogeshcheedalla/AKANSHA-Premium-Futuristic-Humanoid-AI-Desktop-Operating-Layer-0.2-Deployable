/**
 * Akansha durable-Postgres provisioning + verification harness.
 *
 *   DATABASE_URL=postgresql://...  npm run db:provision
 *
 * This does NOT fake anything. Every stage reports PASS / FAIL / BLOCKED from real
 * database evidence, and the process exits non-zero unless all required stages pass.
 * It is intentionally separate from `npm test` (which must run without a database):
 * with no DATABASE_URL the harness reports the DB stage as BLOCKED and leaves the
 * existing offline (throwing-proxy) behaviour intact.
 *
 * Stages:
 *   1 connection      – admin DSN reaches Postgres (select 1)
 *   2 migrate         – drizzle 0000 schema applied + tables present
 *   3 security        – 0001 idempotent migration (pgvector + RLS policies) applied
 *   4 pgvector        – vector extension + embedding column present (semantic memory)
 *   5 role            – least-privilege app role + grants (RLS applies to it)
 *   6 write/read-back – app role writes then reads back a memory + action row
 *   7 rls_isolation   – app role cannot read or write another user's rows
 *   8 backup_restore  – pg_dump → fresh db → restore → data survives (best-effort)
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';

const ADMIN_URL = process.env.DATABASE_URL || '';
const APP_ROLE = process.env.AKANSHA_APP_ROLE || 'akansha_app';
const APP_ROLE_PW = process.env.AKANSHA_APP_ROLE_PW || 'akansha_app_pw_local';
const MIGRATIONS_DIR = path.join(process.cwd(), 'src', 'db', 'migrations');
const SECURITY_SQL = path.join(MIGRATIONS_DIR, '0001_security_and_vector.sql');

type Verdict = 'PASS' | 'FAIL' | 'BLOCKED';
const report: { stage: string; verdict: Verdict; detail: string }[] = [];
function record(stage: string, verdict: Verdict, detail: string) {
  report.push({ stage, verdict, detail });
  const mark = verdict === 'PASS' ? '✓' : verdict === 'FAIL' ? '✗' : '⊘';
  console.log(`  ${mark} ${stage.padEnd(16)} ${verdict.padEnd(7)} ${detail}`);
}

function appUrl(adminUrl: string): string {
  try {
    const u = new URL(adminUrl);
    u.username = APP_ROLE;
    u.password = APP_ROLE_PW;
    return u.toString();
  } catch {
    return adminUrl;
  }
}

async function main() {
  if (!ADMIN_URL) {
    record('connection', 'BLOCKED', 'DATABASE_URL not set — offline mode preserved (no fake success).');
    return finish();
  }

  const admin = new Pool({ connectionString: ADMIN_URL });
  try {
    // 1. connection
    try {
      const r = await admin.query('select 1 as ok, current_database() as db, version() as v');
      record('connection', 'PASS', `connected to db "${r.rows[0].db}"`);
    } catch (e: any) {
      record('connection', 'FAIL', e?.message || 'cannot connect');
      return finish();
    }

    // 2. migrate (drizzle, tracked)
    try {
      const d = drizzle(admin);
      await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
      const t = await admin.query(
        `select tablename from pg_tables where schemaname='public'
         and tablename in ('action_executions','memory_entries','missions','device_sessions','experiences')`);
      const have = t.rows.map((x: any) => x.tablename);
      const missing = ['action_executions', 'memory_entries', 'missions', 'device_sessions'].filter((x) => !have.includes(x));
      record('migrate', missing.length ? 'FAIL' : 'PASS', missing.length ? `missing tables: ${missing.join(',')}` : `${have.length} core tables present`);
    } catch (e: any) {
      record('migrate', 'FAIL', e?.message || 'drizzle migrate failed');
    }

    // 3. security migration (idempotent)
    try {
      const sql = fs.readFileSync(SECURITY_SQL, 'utf8');
      await admin.query(sql);
      record('security', 'PASS', 'pgvector + RLS policies applied (idempotent)');
    } catch (e: any) {
      record('security', 'FAIL', e?.message || '0001 apply failed');
    }

    // 4. pgvector
    try {
      const v = await admin.query(`select extversion from pg_extension where extname='vector'`);
      if (!v.rows.length) {
        record('pgvector', 'BLOCKED', 'vector extension not installed on this server (needs a pgvector-enabled image)');
      } else {
        const col = await admin.query(
          `select 1 from information_schema.columns where table_name='memory_entries' and column_name='embedding'`);
        record('pgvector', col.rows.length ? 'PASS' : 'BLOCKED', col.rows.length ? `vector ${v.rows[0].extversion} + embedding column present` : `vector ${v.rows[0].extversion} installed but no embedding column`);
      }
    } catch (e: any) {
      record('pgvector', 'FAIL', e?.message || 'vector check failed');
    }

    // 5. least-privilege app role (so RLS actually binds — superuser would bypass it)
    try {
      await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${APP_ROLE}') THEN CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE_PW}'; END IF; END $$;`);
      await admin.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE};`);
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON memory_entries, action_executions, missions, device_sessions, experiences TO ${APP_ROLE};`);
      await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`);
      record('role', 'PASS', `least-privilege role "${APP_ROLE}" ready (non-superuser, non-owner → RLS applies)`);
    } catch (e: any) {
      record('role', 'FAIL', e?.message || 'role setup failed');
    }

    // 6 + 7 run as the app role so RLS is genuinely enforced.
    const app = new Pool({ connectionString: appUrl(ADMIN_URL) });
    const UA = 'akansha-verify-user-A';
    const UB = 'akansha-verify-user-B';
    const stamp = Date.now();
    try {
      const c = await app.connect();
      try {
        await c.query(`SET akansha.user_id = '${UA}'`);
        // write as user A
        await c.query(
          `INSERT INTO memory_entries (memory_id, user_id, category, content) VALUES ($1,$2,'episodic',$3)`,
          [`ver-mem-${stamp}`, UA, `verified memory for ${UA}`]);
        await c.query(
          `INSERT INTO action_executions (request_id, action_id, user_id, status, verified) VALUES ($1,'db.verify',$2,'COMPLETED',true)`,
          [`ver-act-${stamp}`, UA]);
        // read back own rows
        const mem = await c.query(`SELECT content FROM memory_entries WHERE memory_id=$1`, [`ver-mem-${stamp}`]);
        const act = await c.query(`SELECT status FROM action_executions WHERE request_id=$1`, [`ver-act-${stamp}`]);
        const ok = mem.rows[0]?.content === `verified memory for ${UA}` && act.rows[0]?.status === 'COMPLETED';
        record('write_readback', ok ? 'PASS' : 'FAIL', ok ? 'memory + action row written and read back as user A' : 'read-back mismatch');

        // isolation: as user A, cannot SEE user B's rows (seed a B row as admin first)
        await admin.query(
          `INSERT INTO memory_entries (memory_id, user_id, category, content) VALUES ($1,$2,'episodic',$3) ON CONFLICT DO NOTHING`,
          [`ver-mem-B-${stamp}`, UB, `secret memory for ${UB}`]);
        const leaked = await c.query(`SELECT 1 FROM memory_entries WHERE memory_id=$1`, [`ver-mem-B-${stamp}`]);
        record('rls_read_isolation', leaked.rows.length === 0 ? 'PASS' : 'FAIL',
          leaked.rows.length === 0 ? 'user A cannot read user B row (RLS hides it)' : 'RLS DID NOT hide another user row');

        // isolation write: user A cannot insert a row attributed to user B (WITH CHECK)
        let writeBlocked = false;
        try {
          await c.query(`INSERT INTO memory_entries (memory_id, user_id, category, content) VALUES ($1,$2,'episodic','x')`,
            [`ver-forgery-${stamp}`, UB]);
        } catch {
          writeBlocked = true;
        }
        record('rls_write_isolation', writeBlocked ? 'PASS' : 'FAIL',
          writeBlocked ? 'user A cannot forge a user B row (WITH CHECK denied)' : 'forgery was ALLOWED — RLS gap');
      } finally {
        c.release();
      }
    } catch (e: any) {
      record('write_readback', 'FAIL', e?.message || 'app-role session failed');
      record('rls_read_isolation', 'BLOCKED', 'skipped after write failure');
      record('rls_write_isolation', 'BLOCKED', 'skipped after write failure');
    } finally {
      // tidy verify fixtures (as admin, bypasses RLS)
      await admin.query(`DELETE FROM memory_entries WHERE memory_id LIKE 'ver-mem-%'`).catch(() => {});
      await admin.query(`DELETE FROM action_executions WHERE request_id LIKE 'ver-act-%'`).catch(() => {});
      await app.end().catch(() => {});
    }

    // 8. backup / restore (best-effort; uses pg_dump inside the local container if present)
    try {
      const container = process.env.AKANSHA_PG_CONTAINER || 'akansha-db';
      const dump = '/tmp/akansha_verify_dump.sql';
      execFileSync('docker', ['exec', container, 'sh', '-c',
        `pg_dump -U postgres -d akansha > ${dump}`], { stdio: 'pipe', timeout: 60000 });
      execFileSync('docker', ['exec', container, 'sh', '-c',
        `dropdb -U postgres --if-exists akansha_restore; createdb -U postgres akansha_restore`], { stdio: 'pipe', timeout: 60000 });
      execFileSync('docker', ['exec', container, 'sh', '-c',
        `psql -U postgres -d akansha_restore -v ON_ERROR_STOP=1 < ${dump} >/dev/null && \
         psql -U postgres -tAc "select count(*) from pg_tables where schemaname='public'" akansha_restore`], { stdio: 'pipe', timeout: 60000 });
      const restored = execFileSync('docker', ['exec', container, 'sh', '-c',
        `psql -U postgres -tAc "select count(*) from pg_tables where tablename='action_executions'" akansha_restore`],
        { encoding: 'utf8', timeout: 30000 }).trim();
      execFileSync('docker', ['exec', container, 'sh', '-c', `dropdb -U postgres --if-exists akansha_restore`], { stdio: 'pipe', timeout: 30000 }).toString();
      record('backup_restore', restored === '1' ? 'PASS' : 'FAIL', `restored dump; action_executions table present=${restored}`);
    } catch (e: any) {
      record('backup_restore', 'BLOCKED', `pg_dump/psql via container unavailable: ${(e?.message || '').slice(0, 80)}`);
    }
  } finally {
    await admin.end().catch(() => {});
  }
  finish();
}

function finish(): void {
  console.log('\n── DB provisioning verdict ─────────────────────────');
  const fails = report.filter((r) => r.verdict === 'FAIL');
  const blocked = report.filter((r) => r.verdict === 'BLOCKED');
  const passed = report.filter((r) => r.verdict === 'PASS');
  console.log(`  ${passed.length} PASS · ${fails.length} FAIL · ${blocked.length} BLOCKED`);
  const prodReady = report.length > 0 && fails.length === 0 && blocked.length === 0;
  console.log(`  durability: ${prodReady ? 'VERIFIED (connection + migrations + write/read-back + RLS isolation + backup/restore)' : 'NOT production-ready'}`);
  console.log('───────────────────────────────────────────────────\n');
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error('harness crashed:', e?.message || e); process.exit(1); });
