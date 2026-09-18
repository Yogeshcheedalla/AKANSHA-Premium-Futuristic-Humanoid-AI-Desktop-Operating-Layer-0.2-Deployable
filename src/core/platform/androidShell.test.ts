import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

// These tests validate the SOURCE of the Android shell (tracked config + mobile-app webDir + src/).
// Anything that depends on the GENERATED native project (android/, produced by `cap add android`)
// is guarded so `npm test` stays green on machines that have not scaffolded the native project.

test('capacitor shell opens directly into the Akansha app (not the marketing landing)', () => {
  const cfg = JSON.parse(read('capacitor.config.json'));
  assert.equal(cfg.server.url, 'https://akansha-gamma.vercel.app/app', 'phone must boot into /app (sign-in gate/dashboard), not the / landing');
  assert.ok(!/localhost|127\.0\.0\.1|:3000/.test(cfg.server.url), 'no localhost/dev origin in the production shell');
  assert.ok(cfg.server.url.startsWith('https://'), 'TLS-only remote load');
});

test('capacitor config carries NO secrets and no cleartext', () => {
  const cfg = JSON.parse(read('capacitor.config.json'));
  assert.equal(cfg.server.cleartext, false, 'no cleartext http');
  assert.ok(/ai\.akansha\.mobile/.test(cfg.appId), 'mobile app id set');
  const raw = JSON.stringify(cfg).toLowerCase();
  assert.ok(!/client_secret|api[_-]?key|password|token|gocspx|sk-|private_key/.test(raw), 'config must not embed any credential');
});

test('Android Capacitor project is scaffolded and its bundled config points at production', (t) => {
  if (!exists('android/app/build.gradle')) { t.skip('native project not scaffolded on this machine (run: npx cap add android)'); return; }
  assert.ok(exists('android/gradlew.bat') || exists('android/gradlew'), 'gradle wrapper present');
  const bundled = 'android/app/src/main/assets/capacitor.config.json';
  if (exists(bundled)) {
    const b = JSON.parse(read(bundled));
    assert.equal(b.server.url, 'https://akansha-gamma.vercel.app/app', 'synced asset config points at the production app entry');
  }
});

test('mobile webDir is the minimal shell and bundles NO desktop installer binaries', () => {
  const cfg = JSON.parse(read('capacitor.config.json'));
  assert.equal(cfg.webDir, 'mobile-app', 'mobile bundles a dedicated minimal webDir, not the desktop `public/` tree');
  const offenders = fs.readdirSync(path.join(ROOT, 'mobile-app'), { recursive: true }).map(String).filter((f) => /\.(exe|msi|dmg|AppImage)$/i.test(f));
  assert.deepEqual(offenders, [], 'no desktop installer binaries in the mobile webDir');
  assert.ok(exists('public/downloads'), 'web/Windows downloads folder preserved');
});

test('the local fallback boot page forwards to the real hosted origin (never a dead offline page)', () => {
  const cfg = JSON.parse(read('capacitor.config.json'));
  const html = read('mobile-app/index.html');
  const ORIGIN = cfg.server.url as string;
  // With server.url set, Capacitor's Bridge loads the remote origin directly (Bridge.java 626-644);
  // the bundled page is a dormant fallback and MUST forward to the same origin, not strand the user.
  assert.ok(html.includes(ORIGIN), 'fallback forwards to the exact configured production origin');
  assert.ok(/location\.replace|http-equiv=["']refresh/i.test(html), 'fallback actively navigates to the production origin');
  assert.ok(!/localhost|127\.0\.0\.1/.test(html), 'fallback never points at localhost');
});

test('Android manifest requests ONLY purpose-backed permissions (mic + internet; no unrelated perms)', (t) => {
  if (!exists('android/app/src/main/AndroidManifest.xml')) { t.skip('native project not scaffolded'); return; }
  const m = read('android/app/src/main/AndroidManifest.xml');
  const has = (p: string) => new RegExp(`uses-permission android:name="android\\.permission\\.${p}"`).test(m);
  assert.ok(has('INTERNET'), 'INTERNET required to reach the hosted origin + /api');
  assert.ok(has('RECORD_AUDIO'), 'RECORD_AUDIO backs the existing web voice (getUserMedia) in the WebView');
  // Do NOT request permissions whose features are not implemented (Play policy + project rule):
  for (const p of ['POST_NOTIFICATIONS', 'SYSTEM_ALERT_WINDOW', 'FOREGROUND_SERVICE', 'BLUETOOTH', 'BLUETOOTH_CONNECT', 'CAMERA']) {
    assert.ok(!has(p), `unrelated permission ${p} must NOT be requested without an implemented feature`);
  }
});

test('the mobile shell stays Electron-free and reuses the shared /api contract (one brain)', () => {
  const offenders = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
    .map((f) => String(f))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => {
      try { return /from ['"]electron['"]|require\(['"]electron['"]\)/.test(read(path.join('src', f))); }
      catch { return false; }
    });
  assert.deepEqual(offenders, [], 'no Electron imports in src/ — mobile reuses the web core unchanged');
});
