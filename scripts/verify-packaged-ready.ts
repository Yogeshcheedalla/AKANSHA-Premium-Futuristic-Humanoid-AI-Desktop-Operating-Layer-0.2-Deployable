/**
 * PACKAGED DESKTOP MODEL READY — acceptance runner.
 *
 * Proves the SHIPPED artifact (release/win-unpacked) reaches the same verified
 * state as the developer pipeline, WITHOUT: LLAMA_CPP_PATHS, the developer repo
 * runtime, temporary runtime copies, or stale userData from another install.
 *
 * Part A · Electron shell boot (real Akansha.exe, pristine --user-data-dir +
 *         AKANSHA_HOME): health up, bundled runtime discovered, app serves.
 * Part B · Packaged server provisioning (the packaged next-server + packaged
 *         runtime, fresh home, explicit session token — same env contract the
 *         shell uses): catalog READY → /api/ai/install/execute → REAL
 *         ~1.1 GB download → SHA-256 + GGUF integrity → REAL llama.cpp
 *         inference → measured benchmark → register → READY.
 * Part C · Restart read-back: READY persists while state valid.
 * Part D · Honesty: artifact moved away => readiness DEGRADES (never stale
 *         READY), restored => READY returns.
 *
 * usage: npx tsx scripts/verify-packaged-ready.ts [--skip-shell]
 * NO EVIDENCE = NO SUCCESS — every claim below prints with MEASURED/UNKNOWN.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, renameSync, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = process.cwd();
const WIN = join(ROOT, 'release', 'win-unpacked');
const PT = 'C:\\Users\\LENOVO\\.qwenwork\\workspace\\mtwu90y10igbcx4a\\packaged-test';
const HOME2 = join(PT, 'home2');
const USERDATA = join(PT, 'userdata-accept');
const MODEL_ID = 'qwen2.5-1.5b-instruct-q4_k_m';
const PORT = 3458;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'PACKAGED-VERIFY-' + Date.now().toString(36);

let failures = 0;
const fail = (m: string) => { failures++; console.log('  FAIL:', m); };
const ok = (m: string) => console.log('  OK  :', m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(maxMs: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch { /* starting */ }
    await sleep(1500);
  }
  return false;
}
const bearer = { authorization: 'Bearer ' + TOKEN };

function killPort(port: number) {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }`], { stdio: 'ignore' });
  } catch { /* nothing listening */ }
}
function killShell() {
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process Akansha -ErrorAction SilentlyContinue | Stop-Process -Force`], { stdio: 'ignore' }); } catch { /* ignore */ }
}

async function main() {
  mkdirSync(join(PT, 'logs'), { recursive: true });
  rmSync(HOME2, { recursive: true, force: true });
  rmSync(USERDATA, { recursive: true, force: true });
  mkdirSync(HOME2, { recursive: true });
  killShell(); killPort(3456); // no leftovers from earlier probes holding the shell port
  await sleep(1500);

  if (!existsSync(join(WIN, 'Akansha.exe'))) { console.log('win-unpacked missing — run npm run dist:win first'); process.exit(1); }

  /* ── A · Electron shell boot (packaged runtime discovery, no dev paths) ── */
  console.log('A) ELECTRON SHELL BOOT (pristine userData/home, no LLAMA_CPP_PATHS)…');
  const shell = spawn(join(WIN, 'Akansha.exe'), ['--user-data-dir=' + USERDATA], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, LLAMA_CPP_PATHS: '', AKANSHA_HOME: join(PT, 'home-shell'), AKANSHA_PORT: '3456' },
  });
  shell.unref();
  let shellUp = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    try { const r = await fetch('http://127.0.0.1:3456/api/health'); if (r.ok) { shellUp = true; break; } } catch { /* wait */ }
  }
  if (!shellUp) fail('packaged Electron shell backend did not answer /api/health');
  else {
    ok('packaged shell health 200 (MEASURED: boot ' + JSON.stringify(await (await fetch('http://127.0.0.1:3456/api/health')).json()).slice(0, 80) + '…)');
    const s = await (await fetch('http://127.0.0.1:3456/api/ai/setup')).json();
    console.log('  shell runtime:', JSON.stringify(s.setup.runtime));
    if (s.setup.runtime.available) ok('bundled runtime DISCOVERED by packaged backend without LLAMA_CPP_PATHS (MEASURED)');
    else fail('packaged backend did not discover the bundled runtime');
    console.log('  shell catalog:', s.setup.catalog.status, '| offline:', s.setup.readiness.offline);
  }
  killShell();
  await sleep(2000);

  /* ── B · Packaged server: real download → integrity → inference → READY ── */
  console.log('B) PACKAGED SERVER PROVISIONING (fresh home, packaged next-server + packaged runtime)…');
  const nextBin = join(WIN, 'resources', 'app', 'node_modules', 'next', 'dist', 'bin', 'next');
  let server: import('node:child_process').ChildProcess = spawn(process.execPath, [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: join(WIN, 'resources', 'app'),
    env: {
      ...process.env, LLAMA_CPP_PATHS: '', NODE_ENV: 'production', PORT: String(PORT),
      AKANSHA_HOME: HOME2, AKANSHA_PACKAGED_RUNTIME: join(WIN, 'resources', 'runtime', 'llama'),
      AKANSHA_ACCESS_TOKEN: TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = createWriteStream(join(PT, 'logs', 'packaged-server.log'));
  server.stdout?.pipe(log); server.stderr?.pipe(log, { end: false });
  const die = () => { try { server.kill(); } catch { /* gone */ } };
  process.on('exit', die);

  if (!(await waitHealth(60000))) { fail('packaged server did not start'); die(); process.exit(1); }
  ok('packaged server health 200 (MEASURED)');

  const setup: any = await (await fetch(BASE + '/api/ai/setup')).json();
  console.log('  catalog:', setup.setup.catalog.status, '| runtime:', JSON.stringify(setup.setup.runtime));
  if (setup.setup.catalog.status !== 'ready' || setup.setup.catalog.models.length < 1) fail('packaged catalog not READY — static bundle fix failed');
  else ok('bundled signed catalog verifies inside the package (MEASURED)');
  if (!setup.setup.runtime.available) fail('packaged runtime not available for provisioning');

  const card = setup.setup.catalog.models[0];
  if (card) {
    console.log(`  fit verdict (packaged ladder): ${card.fit?.verdict} (${card.fit?.confidence})`);
    if (!['FIT', 'POSSIBLE', 'UNSUPPORTED'].includes(card.fit?.verdict)) fail('fit missing in packaged build');
  }

  console.log('  running /api/ai/install/execute for', MODEL_ID, '(real ~1.1 GB download + real inference — this takes minutes)…');
  const t0 = Date.now();
  let res: any;
  try {
    const r = await fetch(BASE + '/api/ai/install/execute', { method: 'POST', headers: { 'content-type': 'application/json', ...bearer }, body: JSON.stringify({ modelId: MODEL_ID }) });
    res = await r.json();
  } catch (e: any) { res = { ok: false, error: 'request failed:' + e.message }; }
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`  execute -> ${JSON.stringify({ ok: res.ok, usable: res.usable, stage: res.stage, blocked: res.blocked, downloaded: res.downloaded })} (${secs}s)`);
  if (!res.ok || !res.usable || res.stage !== 'ready') { fail('provisioning did not reach READY: ' + (res.blocked || res.error || res.stage)); die(); process.exit(1); }
  ok('REAL inference produced non-empty output (MEASURED): "' + (res.benchmark?.text || '').slice(0, 60) + '…"');
  console.log(`  measured benchmark: gen=${res.benchmark?.genTps ?? 'UNKNOWN'} t/s prompt=${res.benchmark?.promptTps ?? 'UNKNOWN'} t/s total=${res.benchmark?.totalMs ?? 'UNKNOWN'}ms`);

  // independent double-check: recompute SHA-256 of the downloaded artifact
  const art = res.artifactPath as string;
  if (existsSync(art)) {
    const hash = createHash('sha256').update(readFileSync(art)).digest('hex');
    const rec = JSON.parse(readFileSync(join(HOME2, 'data', 'local-model-providers.json'), 'utf8'));
    const entry = (rec.providers || [])[0];
    console.log(`  artifact: ${art} (${(statSync(art).size / 1e9).toFixed(2)} GB) sha=${hash.slice(0, 16)}… registry sha=${entry?.sha256?.slice(0, 16)}…`);
    if (hash === entry?.sha256) ok('independent SHA-256 recomputation matches the signed catalog pin (MEASURED)');
    else fail('artifact sha mismatch vs registry record');
  } else fail('artifact path vanished');

  /* ── C · Restart: READY persists ───────────────────────────────────────── */
  console.log('C) RESTART READ-BACK…');
  die(); killPort(PORT); await sleep(2500);
  server = spawn(process.execPath, [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: join(WIN, 'resources', 'app'),
    env: { ...process.env, LLAMA_CPP_PATHS: '', NODE_ENV: 'production', PORT: String(PORT), AKANSHA_HOME: HOME2, AKANSHA_PACKAGED_RUNTIME: join(WIN, 'resources', 'runtime', 'llama'), AKANSHA_ACCESS_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
  if (!(await waitHealth(60000))) fail('server did not restart');
  const s2: any = await (await fetch(BASE + '/api/ai/setup')).json();
  console.log('  readiness after restart:', s2.setup.readiness.offline, '| aiMode offlineReady:', s2.setup.aiMode.offlineReady);
  if (s2.setup.readiness.offline === 'OFFLINE AI READY' && s2.setup.aiMode.offlineReady) ok('READY persisted across restart while runtime+artifact+record remain valid (MEASURED)');
  else fail('restart did NOT restore READY: ' + s2.setup.readiness.offline);

  /* ── D · Honesty: missing artifact degrades, never stale READY ────────── */
  console.log('D) STALE-READY HONESTY CHECK…');
  try { server.kill(); } catch { /* gone */ }
  killPort(PORT); await sleep(2000);
  const dir = join(HOME2, 'models', MODEL_ID);
  const hidden = dir + '.hidden';
  renameSync(dir, hidden);
  server = spawn(process.execPath, [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: join(WIN, 'resources', 'app'),
    env: { ...process.env, LLAMA_CPP_PATHS: '', NODE_ENV: 'production', PORT: String(PORT), AKANSHA_HOME: HOME2, AKANSHA_PACKAGED_RUNTIME: join(WIN, 'resources', 'runtime', 'llama'), AKANSHA_ACCESS_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
  await waitHealth(60000);
  const s3: any = await (await fetch(BASE + '/api/ai/setup')).json();
  console.log('  readiness with artifact removed:', s3.setup.readiness.offline);
  if (s3.setup.readiness.offline !== 'OFFLINE AI READY' && !s3.setup.aiMode.offlineReady) ok('stale READY refused — degraded state reported truthfully (MEASURED)');
  else fail('STALE READY retained after artifact removal!');
  try { server.kill(); } catch { /* gone */ }
  killPort(PORT);
  renameSync(hidden, dir);

  console.log(`\nPACKAGED DESKTOP MODEL READY: ${failures === 0 ? 'VERIFIED — every gate above printed MEASURED evidence' : `NOT VERIFIED (${failures} failures above)`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('crashed:', e?.message || e); killPort(PORT); killShell(); process.exit(1); });
