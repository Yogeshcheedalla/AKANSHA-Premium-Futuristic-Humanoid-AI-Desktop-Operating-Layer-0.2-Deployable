/**
 * Runtime durable-write check — exercises EVERY table the app writes to, through the
 * actual `@/db` client + drizzle schema, against the connected database. Catches schema
 * drift / NOT NULL / RLS regressions that only surface once a real DB is wired up.
 * Not part of `npm test` (needs a live DB). Usage: DATABASE_URL=... npm run db:runtimecheck
 */
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import {
  memoryEntries, actionExecutions, decisionTraces, requestLedger, modelProviders,
  providerModels, connectorConnections, credentials, deviceSessions, missions, jobs, actionEvents,
} from '@/db/schema';

const stamp = Date.now();
const P = (s: string) => `rt-${s}-${stamp}`;
const out: { table: string; verdict: string; detail: string }[] = [];

async function check(table: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    out.push({ table, verdict: 'PASS', detail: 'inserted' });
  } catch (e: any) {
    out.push({ table, verdict: 'FAIL', detail: String(e?.message || e).replace(/(postgres(?:ql)?:\/\/)\S*?@/gi, '$1***@').slice(0, 140) });
  }
}

async function main() {
  await check('memory_entries', () => db.insert(memoryEntries).values({ memoryId: P('mem'), userId: 'rt-user', category: 'episodic', content: 'runtime write check' }));
  await check('action_executions', () => db.insert(actionExecutions).values({ requestId: P('act'), actionId: 'db.check', userId: 'rt-user', status: 'COMPLETED', verified: true }));
  await check('decision_traces', () => db.insert(decisionTraces).values({ traceId: P('tr'), requestId: P('req'), kind: 'model' }));
  await check('request_ledger', () => db.insert(requestLedger).values({ requestId: P('req2'), status: 'OK' }));
  await check('model_providers', () => db.insert(modelProviders).values({ providerId: P('prov'), name: 'rt', type: 'local' }));
  await check('provider_models', () => db.insert(providerModels).values({ providerId: P('prov'), modelId: 'rt-model' }));
  await check('connector_connections', () => db.insert(connectorConnections).values({ connectionId: P('conn'), provider: 'rt', category: 'test' }));
  await check('credentials', () => db.insert(credentials).values({ ref: P('cred'), encrypted: 'x', iv: 'y' }));
  await check('device_sessions', () => db.insert(deviceSessions).values({ id: P('dev'), userId: 'rt-user' }));
  await check('missions', () => db.insert(missions).values({ missionId: P('mis'), goal: 'rt', userId: 'rt-user' }));
  await check('jobs', () => db.insert(jobs).values({ id: P('job'), kind: 'rt', status: 'QUEUED' }));
  await check('action_events', () => db.insert(actionEvents).values({ type: 'action.completed', requestId: P('act'), actionId: 'db.check' }));

  // read-back: confirm the action_executions probe row is actually queryable
  let readBack = false;
  try {
    const rb: any = await db.execute(sql`select request_id from action_executions where request_id = ${P('act')}`);
    const rows = rb?.rows ?? rb ?? [];
    readBack = Array.isArray(rows) ? rows.length > 0 : false;
  } catch { readBack = false; }

  // cleanup all probe rows
  const cleanups = [
    `delete from memory_entries where memory_id like 'rt-%'`,
    `delete from action_executions where request_id like 'rt-%'`,
    `delete from decision_traces where trace_id like 'rt-%'`,
    `delete from request_ledger where request_id like 'rt-%'`,
    `delete from model_providers where provider_id like 'rt-%'`,
    `delete from provider_models where provider_id like 'rt-%'`,
    `delete from connector_connections where connection_id like 'rt-%'`,
    `delete from credentials where ref like 'rt-%'`,
    `delete from device_sessions where id like 'rt-%'`,
    `delete from missions where mission_id like 'rt-%'`,
    `delete from jobs where id like 'rt-%'`,
    `delete from action_events where request_id like 'rt-%'`,
  ];
  for (const q of cleanups) { try { await db.execute(sql.raw(q)); } catch { /* best-effort */ } }

  const pass = out.filter((r) => r.verdict === 'PASS').length;
  console.log('\n── Runtime durable-write check ─────────────────────');
  for (const r of out) console.log(`  ${r.verdict === 'PASS' ? '✓' : '✗'} ${r.table.padEnd(22)} ${r.verdict} ${r.verdict === 'FAIL' ? r.detail : ''}`);
  console.log(`\n  ${pass}/${out.length} tables writable · read-back=${readBack ? 'PASS' : 'FAIL'}`);
  console.log(`  durable persistence: ${pass === out.length && readBack ? 'FULLY FUNCTIONAL' : 'INCOMPLETE'}`);
  console.log('───────────────────────────────────────────────────\n');
  process.exit(pass === out.length && readBack ? 0 : 1);
}
main().catch((e) => { console.error('crashed:', e?.message || e); process.exit(1); });
