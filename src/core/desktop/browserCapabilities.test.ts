import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionRegistry } from '@/core/actions/ActionRegistry';
import { ActionDispatcher } from '@/core/actions/ActionDispatcher';
import { registerBrowserCapabilities } from './browserCapabilities';

let n = 0; const rid = () => `br-${Date.now()}-${n++}`;

function setup(resolve: (q: string, o?: any) => Promise<any>, running: string[]) {
  const reg = new ActionRegistry();
  const launched: { exe: string; args: string[] }[] = [];
  registerBrowserCapabilities({
    registry: reg,
    resolve,
    provider: {
      launchExe: async (exe: string, args: string[]) => { launched.push({ exe, args }); return { found: true, processAlive: true, pid: 111, title: 'x' }; },
      processExists: async (names: string[]) => { const hit = names.find((x) => running.includes(x)); return { running: !!hit, pid: hit ? 111 : undefined }; },
    },
  });
  return { d: new ActionDispatcher(reg), launched };
}

test('browser.navigate opens a validated URL and verifies a browser process', async () => {
  const { d, launched } = setup(async () => null, ['chrome']);
  const r = await d.dispatch({ actionId: 'browser.navigate', requestId: rid(), confirmed: true, payload: { url: 'https://www.youtube.com/' } });
  assert.equal(r.status, 'COMPLETED');
  assert.equal(r.verification?.verified, true);
  assert.ok(launched[0].args.includes('https://www.youtube.com/'));
});

test('named browser that is NOT installed → APP_NOT_FOUND, never a substitute launch', async () => {
  const { d, launched } = setup(async () => null, ['msedge']); // brave unresolved, edge running
  const r = await d.dispatch({ actionId: 'browser.navigate', requestId: rid(), confirmed: true, payload: { url: 'https://youtube.com', browser: 'brave' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failure?.code, 'APP_NOT_FOUND');
  assert.equal(launched.length, 0); // nothing launched — no Edge substitution
});

test('named brave resolves and ONLY the brave process counts', async () => {
  const { d } = setup(async () => ({ executable: 'C:\\brave.exe', processName: 'brave', titleHint: 'Brave' }), ['msedge']); // brave launched but only edge "running"
  const r = await d.dispatch({ actionId: 'browser.navigate', requestId: rid(), confirmed: true, payload: { url: 'https://youtube.com', browser: 'brave' } });
  assert.equal(r.status, 'FAILED'); // brave process not observed → not a fake success
});

test('invalid URL rejected without launching', async () => {
  const { d, launched } = setup(async () => null, ['chrome']);
  const r = await d.dispatch({ actionId: 'browser.navigate', requestId: rid(), confirmed: true, payload: { url: 'javascript:alert(1)' } });
  assert.equal(r.status, 'FAILED');
  assert.equal(launched.length, 0);
});
