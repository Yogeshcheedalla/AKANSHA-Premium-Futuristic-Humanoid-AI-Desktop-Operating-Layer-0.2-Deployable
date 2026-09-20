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
