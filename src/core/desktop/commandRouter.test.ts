import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeCommand } from './commandRouter';

test('"open youtube" → browser.navigate with a real URL (no LLM)', async () => {
  const r = await routeCommand('open youtube');
  assert.equal(r?.actionId, 'browser.navigate');
  assert.equal(r?.payload.url, 'https://www.youtube.com/');
  assert.equal(r?.payload.browser, undefined);
});

test('"open youtube in brave" → browser.navigate with browser=brave (typed, never Edge)', async () => {
  const r = await routeCommand('open youtube in brave');
  assert.equal(r?.actionId, 'browser.navigate');
  assert.equal(r?.payload.url, 'https://www.youtube.com/');
  assert.equal(r?.payload.browser, 'brave');
});

test('"open notepad" → curated desktop.app.launch', async () => {
  const r = await routeCommand('open notepad');
  assert.equal(r?.actionId, 'desktop.app.launch');
  assert.equal(r?.payload.application, 'notepad');
});

test('"close notepad" / "focus brave" → close/focus on canonical app', async () => {
  assert.equal((await routeCommand('close notepad'))?.actionId, 'desktop.app.close');
  const f = await routeCommand('focus brave');
  assert.equal(f?.actionId, 'desktop.window.focus');
  assert.equal(f?.payload.application, 'brave');
});

test('"open brave" (browser alone) → launch the browser app, not navigate', async () => {
  const r = await routeCommand('open brave');
  assert.equal(r?.actionId, 'desktop.app.launch');
  assert.equal(r?.payload.application, 'brave');
});

test('shell-injection text is rejected (null)', async () => {
  assert.equal(await routeCommand('open notepad && whoami'), null);
  assert.equal(await routeCommand('what is the weather'), null);
});

test('REGRESSION "open files" → File Explorer, never VLC/website', async () => {
  const r = await routeCommand('open files');
  assert.equal(r?.actionId, 'desktop.app.launchResolved');
  assert.equal(r?.payload.executable, 'explorer.exe');
  assert.equal(r?.payload.label, 'File Explorer');
});

test('REGRESSION "open settings" → Windows Settings, never settings.com', async () => {
  const r = await routeCommand('open settings');
  assert.equal(r?.actionId, 'desktop.app.launchResolved');
  assert.equal(r?.payload.label, 'Windows Settings');
  assert.ok(Array.isArray(r?.payload.args) && (r!.payload.args as string[]).some((a) => /ms-settings/i.test(a)));
});

test('"open settings.com" → WEBSITE, not Windows Settings', async () => {
  const r = await routeCommand('open settings.com');
  assert.equal(r?.actionId, 'browser.navigate');
  assert.match(String(r?.payload.url), /settings\.com/);
});

test('"open downloads" → Downloads folder (system entity), not web', async () => {
  const r = await routeCommand('open downloads');
  assert.equal(r?.actionId, 'desktop.app.launchResolved');
  assert.equal(r?.payload.label, 'Downloads');
});

test('generic word with no system/app/site meaning → null (never a fabricated URL)', async () => {
  assert.equal(await routeCommand('open zzzqq'), null);
});

test('natural variants resolve identically to File Explorer', async () => {
  for (const s of ['open files', 'launch file explorer', 'show me my files', 'bring up explorer']) {
    const r = await routeCommand(s);
    assert.equal(r?.payload.label, 'File Explorer', s);
  }
});

// ── REGRESSION: the reported Brave → "edge" mislabel (generic word "browser"
//    inside a longer phrase must never hijack the match to Edge) ──────────────

test('REGRESSION "open youtube in the brave browser" → YouTube in Brave, never Edge', async () => {
  const r = await routeCommand('open youtube in the brave browser');
  assert.equal(r?.actionId, 'browser.navigate');
  assert.equal(r?.payload.url, 'https://www.youtube.com/');
  assert.equal(r?.payload.browser, 'brave');
  assert.doesNotMatch(String(r?.payload.application || ''), /edge/i);
});

test('"open brave browser" (browser named with the word "browser") → launch Brave, not Edge', async () => {
  const r = await routeCommand('open brave browser');
  assert.equal(r?.actionId, 'desktop.app.launch');
  assert.equal(r?.payload.application, 'brave');
});

test('generic word alone "open browser" may still default to Edge', async () => {
  const r = await routeCommand('open browser');
  assert.equal(r?.actionId, 'desktop.app.launch');
  assert.equal(r?.payload.application, 'edge');
});

test('REGRESSION compound "open X in the brave browser and ... " never resolves to Edge', async () => {
  const r = await routeCommand('open the brave browser and search for something and I need a timestamp');
  assert.notEqual(String(r?.payload.application || ''), 'edge');
});
