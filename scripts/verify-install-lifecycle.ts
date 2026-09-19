/**
 * Live acceptance for the discovery→trust→install→cancel→retry→READY chain,
 * run against the PACKAGED server + PACKAGED runtime with a clean home:
 * no LLAMA_CPP_PATHS, no dev repo paths. Mirrors spec §21 steps A–Q.
 *   npx tsx scripts/verify-install-lifecycle.ts
 */
import path from 'node:path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, renameSync } from 'node:fs';

const WIN = path.join(process.cwd(), 'release', 'win-unpacked');
const PT = 'C:\\Users\\LENOVO\\.qwenwork\\workspace\\mtwu90y10igbcx4a\\packaged-test';
const HOME = path.join(PT, 'home-lifecycle');
const PORT = 3462;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'LIFECYCLE-' + Date.now().toString(36);
const MODEL = 'llama-3.2-1b-instruct-q4_k_m'; // 0.81 GB — smallest new signed model

let fails = 0;
const ok = (m: string) => console.log('  OK  ', m);
const bad = (m: string) => { fails++; console.log('  FAIL', m); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  return spawn(process.execPath, [path.join(WIN, 'resources', 'app', 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: path.join(WIN, 'resources', 'app'),
    env: {
      ...process.env, LLAMA_CPP_PATHS: '', NODE_ENV: 'production', PORT: String(PORT),
      AKANSHA_HOME: HOME, AKANSHA_PACKAGED_RUNTIME: path.join(WIN, 'resources', 'runtime', 'llama'),
      AKANSHA_ACCESS_TOKEN: TOKEN, AKANSHA_ADMIN_TOKEN: TOKEN,
    },
    stdio: 'ignore',
  });
}
async function waitUp() { for (let i = 0; i < 45; i++) { try { if ((await fetch(BASE + '/api/health')).ok) return true; } catch { /* up? */ } await sleep(1500); } return false; }
const H0 = { 'content-type': 'application/json' };
let H: Record<string, string> = H0;

async function main() {
  rmSync(HOME, { recursive: true, force: true }); mkdirSync(HOME, { recursive: true });
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }`], { stdio: 'ignore' }); } catch { /* free */ }
  let server = startServer();
  process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
  if (!(await waitUp())) { bad('server did not start'); process.exit(1); }
  ok('packaged server up (clean home, no LLAMA_CPP_PATHS)');

  // EXACT desktop bootstrap flow: exchange the local secret for the session
  // cookie (POST /api/auth/session) — the raw passphrase is never a bearer token.
  const sess = await fetch(BASE + '/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: TOKEN }) });
  const sj: any = await sess.json();
  if (sj.role !== 'admin') { bad('desktop session exchange did not yield admin: ' + JSON.stringify(sj)); process.exit(1); }
  const cookie = (sess.headers.getSetCookie?.()[0] || '').split(';')[0];
  if (!cookie) { bad('no session cookie minted'); process.exit(1); }
  ok(`desktop session exchanged (role=${sj.role}) — same path the packaged renderer uses`);
  H = { 'content-type': 'application/json', cookie };

  // A–E: search "llama" → GGUF-first, honest lifecycle per row
  const search: any = await (await fetch(`${BASE}/api/models/search?q=${encodeURIComponent('llama')}`, { headers: H })).json();
  const rows = search.results || [];
  console.log(`  search "llama": ${rows.length} rows`);
  const ggufIdx = rows.map((r: any) => r.isGguf);
  const ggufCount = ggufIdx.filter(Boolean).length;
  const firstNonGguf = ggufIdx.indexOf(false); const lastGguf = ggufIdx.lastIndexOf(true);
  if (ggufCount > 0 && (firstNonGguf === -1 || lastGguf < firstNonGguf)) ok(`C · ${ggufCount} GGUF rows all ranked before non-GGUF rows`); else bad('grouping wrong or no GGUF rows: ' + JSON.stringify(ggufIdx));
  const signedRow = rows.find((r: any) => r.isGguf && r.lifecycle?.action === 'install');
  if (signedRow) ok(`E · signed+fit row has action=install: ${signedRow.id} (catalog=${signedRow.catalogModelId})`); else bad('no installable row found');
  const trustRow = rows.find((r: any) => r.isGguf && r.lifecycle?.state === 'TRUST_REQUIRED');
  if (trustRow) ok(`B · GGUF-but-unsigned row is TRUST_REQUIRED (action=${trustRow.lifecycle.action}, no fake install)`); else console.log('  note  no TRUST_REQUIRED row in this result set');
  const unsup = rows.find((r: any) => r.lifecycle?.state === 'UNSUPPORTED');
  if (unsup) ok(`C · unsupported row explained: ${unsup.lifecycle.reason.slice(0, 60)}`);

  // F: start a REAL install of the signed 0.81 GB model
  console.log(`  F · starting real install: ${MODEL} (0.81 GB download)…`);
  const start: any = await (await fetch(`${BASE}/api/ai/install/execute`, { method: 'POST', headers: H, body: JSON.stringify({ modelId: MODEL }) })).json();
  if (!start.ok || !start.jobId) { bad('install not accepted: ' + JSON.stringify(start)); process.exit(1); }
  ok('G · job accepted: ' + start.jobId);

  // G/H: wait until real bytes flow, then cancel mid-download
  let seen = null as any; let cancelled = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1500);
    seen = (await (await fetch(`${BASE}/api/ai/install/execute?jobId=${start.jobId}`, { headers: H })).json()).job;
    if (seen && seen.bytesDownloaded > 20_000_000 && (seen.state === 'INSTALLING')) {
      const c = await fetch(`${BASE}/api/ai/install/execute/${start.jobId}/cancel`, { method: 'POST', headers: H });
      cancelled = c.ok; ok(`H · cancel requested at ${(seen.bytesDownloaded / 1e6).toFixed(0)} MB downloaded (HTTP ${c.status})`);
      break;
    }
    if (seen && (seen.state === 'VERIFYING' || seen.state === 'INFERENCE_TESTING')) { ok('H · download too fast to cancel mid-stream — testing cancel at verify stage instead');
      const c = await fetch(`${BASE}/api/ai/install/execute/${start.jobId}/cancel`, { method: 'POST', headers: H }); cancelled = c.ok; break; }
  }
  if (!cancelled) bad('never reached a cancellable state');

  // J: final state must be CANCELLED (never READY), partial .part cleaned
  let job = null as any;
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    job = (await (await fetch(`${BASE}/api/ai/install/execute?jobId=${start.jobId}`, { headers: H })).json()).job;
    if (job && (job.state === 'CANCELLED' || job.state === 'READY' || job.state === 'FAILED')) break;
  }
  if (job?.state === 'CANCELLED') ok('J · final state CANCELLED (never READY after cancel)');
  else bad('expected CANCELLED, got ' + job?.state);
  const partFile = path.join(HOME, 'models', MODEL, 'Llama-3.2-1B-Instruct-Q4_K_M.gguf.part');
  if (!existsSync(partFile)) ok('J · partial .part file cleaned up'); else bad('.part file left behind!');
  const reg = path.join(HOME, 'data', 'local-model-providers.json');
  const registered = existsSync(reg) && readFileSync(reg, 'utf8').includes(MODEL);
  if (!registered) ok('J · cancelled job did NOT register the model as usable'); else bad('cancelled model got registered!');

  // K–O: retry → full install → checksum → real inference → READY
  console.log('  K · retrying install (full run)…');
  const retry: any = await (await fetch(`${BASE}/api/ai/install/execute`, { method: 'POST', headers: H, body: JSON.stringify({ modelId: MODEL }) })).json();
  if (!retry.ok || !retry.jobId) bad('retry not accepted: ' + JSON.stringify(retry));
  let done = null as any;
  for (let i = 0; i < 240; i++) {
    await sleep(2500);
    done = (await (await fetch(`${BASE}/api/ai/install/execute?jobId=${retry.jobId}`, { headers: H })).json()).job;
    if (done && (done.state === 'READY' || done.state === 'FAILED')) break;
  }
  if (done?.state === 'READY') ok(`O · READY with measured benchmark gen=${done.benchmark?.genTps} t/s prompt=${done.benchmark?.promptTps} t/s`);
  else bad('install did not reach READY: ' + JSON.stringify(done));

  // P: restart the server → READY must survive (registry + artifact exist)
  try { server.kill(); } catch { /* gone */ }
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }`], { stdio: 'ignore' }); } catch { /* ok */ }
  await sleep(2500);
  server = startServer();
  if (!(await waitUp())) { bad('restart failed'); process.exit(1); }
  const setup: any = await (await fetch(`${BASE}/api/ai/setup`)).json();
  const card = (setup.setup.catalog.models || []).find((m: any) => m.id === MODEL);
  if (setup.setup.readiness.offline === 'OFFLINE AI READY') ok('Q · READY survives restart (offline readiness from persisted registry + real artifact)');
  else bad('after restart offline readiness = ' + setup.setup.readiness.offline);
  const search2: any = await (await fetch(`${BASE}/api/models/search?q=${encodeURIComponent('llama')}`, { headers: H })).json();
  const readyRow = (search2.results || []).find((r: any) => r.lifecycle?.state === 'READY' || r.lifecycle?.state === 'INSTALLABLE');
  if (readyRow) ok(`lifecycle after restart: ${readyRow.id} → ${readyRow.lifecycle.state} (action=${readyRow.lifecycle.action})`);

  try { server.kill(); } catch { /* gone */ }
  await sleep(1200); // let the child settle before exiting (avoids libuv teardown assert noise)
  console.log(`\nINSTALL LIFECYCLE: ${fails === 0 ? 'VERIFIED — cancel stops real work, retry completes, READY survives restart' : `${fails} FAILURES`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error('crashed:', e?.message || e); process.exit(1); });
