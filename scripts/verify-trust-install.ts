/**
 * Live verification of the user-trust install path + storage removal:
 * search an UNSIGNED GGUF repo -> Trust & install -> real download ->
 * integrity -> real inference -> READY -> Remove -> storage freed.
 *   npx tsx scripts/verify-trust-install.ts
 */
import path from 'node:path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';

const WIN = path.join(process.cwd(), 'release', 'win-unpacked');
const PT = 'C:\\Users\\LENOVO\\.qwenwork\\workspace\\mtwu90y10igbcx4a\\packaged-test';
const HOME = path.join(PT, 'home-trust');
const PORT = 3463;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'TRUST-' + Date.now().toString(36);
const REPO = 'unsloth/Llama-3.2-1B-Instruct-GGUF'; // NOT in the signed catalog (bartowski's is)

let fails = 0;
const ok = (m: string) => console.log('  OK  ', m);
const bad = (m: string) => { fails++; console.log('  FAIL', m); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  rmSync(HOME, { recursive: true, force: true }); mkdirSync(HOME, { recursive: true });
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }`], { stdio: 'ignore' }); } catch { /* free */ }
  const server = spawn(process.execPath, [path.join(WIN, 'resources', 'app', 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: path.join(WIN, 'resources', 'app'),
    env: { ...process.env, LLAMA_CPP_PATHS: '', NODE_ENV: 'production', PORT: String(PORT), AKANSHA_HOME: HOME, AKANSHA_PACKAGED_RUNTIME: path.join(WIN, 'resources', 'runtime', 'llama'), AKANSHA_ACCESS_TOKEN: TOKEN, AKANSHA_ADMIN_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
  let up = false;
  for (let i = 0; i < 45 && !up; i++) { try { up = (await fetch(BASE + '/api/health')).ok; } catch { await sleep(1500); } }
  if (!up) { bad('server up'); process.exit(1); }
  const sess = await fetch(BASE + '/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: TOKEN }) });
  const cookie = (sess.headers.getSetCookie?.()[0] || '').split(';')[0];
  const H = { 'content-type': 'application/json', cookie };
  ok('server + admin session');

  // 1) search shows the repo as TRUST_REQUIRED (not a dead Install button)
  const search: any = await (await fetch(`${BASE}/api/models/search?q=${encodeURIComponent('llama 3.2 1b')}`, { headers: H })).json();
  const row = (search.results || []).find((r: any) => r.id === REPO);
  if (row && row.lifecycle?.state === 'TRUST_REQUIRED' && row.lifecycle?.action === 'review-source') ok(`1 · ${REPO} → TRUST_REQUIRED (honest action, no fake install)`);
  else bad('1 · expected TRUST_REQUIRED, got ' + JSON.stringify(row?.lifecycle));

  // 2) trust: pin the REAL LFS checksum
  const trust: any = await (await fetch(BASE + '/api/models/trust', { method: 'POST', headers: H, body: JSON.stringify({ repo: REPO }) })).json();
  if (!trust.ok) { bad('2 · trust failed: ' + trust.error); process.exit(1); }
  ok(`2 · trusted file=${trust.file} size=${(trust.sizeBytes / 1e9).toFixed(2)}GB sha=${trust.sha256}`);

  // 3) re-search: same repo is now install-actionable
  const search2: any = await (await fetch(`${BASE}/api/models/search?q=${encodeURIComponent('llama 3.2 1b')}`, { headers: H })).json();
  const row2 = (search2.results || []).find((r: any) => r.id === REPO);
  if (row2?.lifecycle?.action === 'install' && row2?.catalogModelId === trust.modelId) ok('3 · after trust → action=install (catalogModelId=' + trust.modelId + ')');
  else bad('3 · lifecycle not upgraded: ' + JSON.stringify(row2?.lifecycle));

  // 4) real install: download → integrity → inference → READY
  const start: any = await (await fetch(BASE + '/api/ai/install/execute', { method: 'POST', headers: H, body: JSON.stringify({ modelId: trust.modelId }) })).json();
  if (!start.ok || !start.jobId) { bad('4 · install not accepted: ' + JSON.stringify(start)); process.exit(1); }
  let job: any = null;
  for (let i = 0; i < 240; i++) {
    await sleep(2500);
    job = (await (await fetch(`${BASE}/api/ai/install/execute?jobId=${start.jobId}`, { headers: H })).json()).job;
    if (job && (job.state === 'READY' || job.state === 'FAILED')) break;
  }
  if (job?.state === 'READY') ok(`4 · READY with measured benchmark gen=${job.benchmark?.genTps} t/s prompt=${job.benchmark?.promptTps} t/s`);
  else { bad('4 · install failed: ' + JSON.stringify(job)); process.exit(1); }

  // 5) remove: storage actually reclaimed, READY drops honestly
  const del: any = await (await fetch(`${BASE}/api/ai/models/${encodeURIComponent(trust.modelId)}`, { method: 'DELETE', headers: H })).json();
  const dir = path.join(HOME, 'models', trust.modelId);
  if (del.ok && del.removed && !existsSync(dir)) ok(`5 · removed, freedMB=${del.freedMB}, artifact dir gone, stillUsable=${del.stillUsable}`);
  else bad('5 · remove: ' + JSON.stringify(del));
  const setup: any = await (await fetch(`${BASE}/api/ai/setup`)).json();
  const card = (setup.setup.catalog.models || []).find((m: any) => m.id === trust.modelId);
  if (card && card.lifecycle.state !== 'READY' && (card.lifecycle.action === 'install')) ok('6 · after remove, card honestly back to installable (not READY)');
  else bad('6 · card state after remove: ' + JSON.stringify(card?.lifecycle));

  try { server.kill(); } catch { /* gone */ }
  await sleep(1000);
  console.log(`\nTRUST→INSTALL→REMOVE: ${fails === 0 ? 'VERIFIED end-to-end on real HF artifacts' : fails + ' FAILURES'}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error('crashed:', e?.message || e); process.exit(1); });
