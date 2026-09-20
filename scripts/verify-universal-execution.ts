/**
 * verify-universal-execution.ts — real acceptance for the execution-repair slice.
 *
 * Pure checks (router/planner/emotion/cost) always run. LIVE checks run against a
 * real backend when BASE_URL + AKANSHA_ADMIN_TOKEN are supplied (the packaged app
 * or a dev server); each LIVE check drives the actual command pipeline and then
 * observes the REAL Windows process — NO EVIDENCE = NO SUCCESS. A missing
 * BASE_URL reports the live tests as SKIPPED, never as passed.
 *
 *   npx tsx scripts/verify-universal-execution.ts
 *   BASE_URL=http://127.0.0.1:PORT AKANSHA_ADMIN_TOKEN=... npx tsx scripts/verify-universal-execution.ts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import { routeCommand } from '../src/core/desktop/commandRouter';
import { planTask } from '../src/core/tasks/taskPlanner';
import { deriveEmotionStyle, prosodyFor } from '../src/core/voice/emotion/emotionStyle';
import { modelCostTier } from '../src/core/routing/costPolicy';
import { resolveSite } from '../src/core/execution/applicationResolver';

const BASE = process.env.BASE_URL || '';
const TOKEN = process.env.AKANSHA_ADMIN_TOKEN || '';
let pass = 0, fail = 0, skip = 0;
const ok = (m: string) => { pass++; console.log(`  PASS  ${m}`); };
const bad = (m: string, e?: any) => { fail++; console.log(`  FAIL  ${m}${e ? ' — ' + (e?.message || e) : ''}`); };
const sk = (m: string) => { skip++; console.log(`  SKIP  ${m} (no BASE_URL/TOKEN — not faked as pass)`); };

function procRunning(name: string): boolean {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-Process -Name ${name} -ErrorAction SilentlyContinue).Count`], { encoding: 'utf8', timeout: 8000 }).trim();
    return parseInt(out || '0', 10) > 0;
  } catch { return false; }
}
function killProc(name: string) { try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Stop-Process -Name ${name} -Force -ErrorAction SilentlyContinue`], { timeout: 8000 }); } catch { /* ignore */ } }

async function cmd(text: string): Promise<any> {
  const res = await fetch(`${BASE}/api/akansha/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'x-akansha-token': TOKEN } : {}) },
    body: JSON.stringify({ text, requestId: 'acc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) }),
    credentials: 'same-origin',
  });
  return res.json();
}

async function main() {
  console.log('PURE (deterministic routing / planning / prosody / cost):');
  try {
    const yt = await routeCommand('open youtube');
    assert.equal(yt?.actionId, 'browser.navigate'); assert.equal(yt?.payload.url, 'https://www.youtube.com/');
    ok('open youtube → browser.navigate(youtube)');
  } catch (e) { bad('open youtube routing', e); }
  try {
    const yb = await routeCommand('open youtube in brave');
    assert.equal(yb?.payload.browser, 'brave'); assert.equal(yb?.payload.url, 'https://www.youtube.com/');
    ok('open youtube in brave → browser=brave (typed, no Edge)');
  } catch (e) { bad('open youtube in brave routing', e); }
  try {
    const np = await routeCommand('open notepad');
    assert.equal(np?.actionId, 'desktop.app.launch'); assert.equal(np?.payload.application, 'notepad');
    ok('open notepad → curated app launch (not a website)');
  } catch (e) { bad('open notepad routing', e); }
  try {
    const t = await planTask('open notepad then wait 2 seconds then close it');
    assert.ok(t && t.length >= 3 && t.some((s) => s.kind === 'wait') && t.some((s: any) => s.actionId === 'desktop.app.close'));
    ok('open→wait→close becomes a 3-step durable task');
  } catch (e) { bad('task planning', e); }
  try {
    assert.equal(modelCostTier('openrouter', 'openrouter/free'), 'free');
    assert.equal(modelCostTier('openrouter', 'openrouter/auto'), 'paid');
    assert.equal(modelCostTier('pollinations', 'openai'), 'free');
    ok('free/paid cost tiers correct (no silent paid)');
  } catch (e) { bad('cost tiers', e); }
  try {
    const p = prosodyFor(deriveEmotionStyle({ status: 'COMPLETED' }));
    assert.ok(p.rate > 0 && p.pitch > 0);
    ok('emotion→prosody produces bounded delivery');
  } catch (e) { bad('emotion prosody', e); }
  try { assert.equal(resolveSite('notepad'), 'https://www.notepad.com/'); ok('domain fallback present'); } catch (e) { bad('site fallback', e); }

  console.log('\nLIVE (real command pipeline + real Windows process observation):');
  if (!BASE) {
    ['open notepad → process', 'close notepad → gone', 'open youtube → browser', 'open youtube in brave → brave', 'background open→wait→close', 'voice stop command'].forEach(sk);
  } else {
    // TEST 1/2 open+close notepad
    try { killProc('notepad'); const r = await cmd('open notepad'); await new Promise((s) => setTimeout(s, 2500)); if (r.status === 'COMPLETED' && procRunning('notepad')) ok('open notepad → verified process'); else bad('open notepad', r.response || r.status); } catch (e) { bad('open notepad', e); }
    try { const r = await cmd('close notepad'); await new Promise((s) => setTimeout(s, 1500)); if (r.status === 'COMPLETED' && !procRunning('notepad')) ok('close notepad → process gone'); else bad('close notepad', r.response || r.status); } catch (e) { bad('close notepad', e); }
    // TEST 3 open youtube (default browser)
    try { const r = await cmd('open youtube'); await new Promise((s) => setTimeout(s, 3500)); const any = procRunning('chrome') || procRunning('msedge') || procRunning('brave') || procRunning('firefox'); if (r.status === 'COMPLETED' && any) ok('open youtube → browser process observed'); else bad('open youtube', r.response || r.status); } catch (e) { bad('open youtube', e); }
    // TEST 4 open youtube in brave — must be brave specifically
    try { killProc('brave'); const r = await cmd('open youtube in brave'); await new Promise((s) => setTimeout(s, 4000)); if (r.status === 'COMPLETED' && procRunning('brave')) ok('open youtube in brave → BRAVE process (no Edge substitution)'); else if (r.status === 'FAILED' && /not installed|APP_NOT_FOUND|could not be resolved/i.test(r.response || '')) sk('brave not installed here — honestly reported, not faked'); else bad('open youtube in brave', r.response || r.status); } catch (e) { bad('open youtube in brave', e); }
    // TEST 5 background task survives chat
    try { killProc('notepad'); const r = await cmd('open notepad and wait 3 seconds then close it'); if (r.path === 'background-task' && r.status === 'RUNNING') { const opened = procRunning('notepad'); await new Promise((s) => setTimeout(s, 5000)); const closed = !procRunning('notepad'); if (opened && closed) ok('background task ran open→wait→close after chat returned'); else bad('background task lifecycle', `opened=${opened} closed=${closed}`); } else bad('background task not created', r.path || r.status); } catch (e) { bad('background task', e); }
    // TEST 6 voice stop command (pure, but exercised here)
    try { const { parseVoiceSessionCommand } = await import('../src/ui/voice/AudioEngine'); assert.equal(parseVoiceSessionCommand('stop the voice mode'), 'stop'); ok('spoken "stop the voice mode" recognized'); } catch (e) { bad('voice stop parser', e); }
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed, ${skip} skipped`);
  if (fail > 0) { console.log('FAILED — do not claim success.'); process.exit(1); }
  if (skip > 0) console.log('NOTE: live checks skipped without BASE_URL — run against the packaged app for full evidence.');
}

main().catch((e) => { console.error('crashed:', e?.message || e); process.exit(1); });
