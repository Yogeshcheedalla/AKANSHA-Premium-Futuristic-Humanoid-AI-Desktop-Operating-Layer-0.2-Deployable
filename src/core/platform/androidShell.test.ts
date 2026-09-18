import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('capacitor config targets the real hosted Akansha origin (not localhost/dev)', () => {
  const cfg = JSON.parse(read('capacitor.config.json'));
  assert.equal(cfg.server.url, 'https://akansha-gamma.vercel.app', 'production origin must be the actual deployment URL');
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

test('Android Capacitor project is scaffolded and its bundled config points at production', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'android/app/build.gradle')), 'android gradle project exists');
  assert.ok(fs.existsSync(path.join(ROOT, 'android/gradlew.bat')) || fs.existsSync(path.join(ROOT, 'android/gradlew')), 'gradle wrapper present');
  const bundled = path.join(ROOT, 'android/app/src/main/assets/capacitor.config.json');
  if (fs.existsSync(bundled)) {
    const b = JSON.parse(read('android/app/src/main/assets/capacitor.config.json'));
    assert.equal(b.server.url, 'https://akansha-gamma.vercel.app', 'synced asset config matches production origin');
  }
});

test('mobile webDir is the minimal shell and bundles NO desktop installer binaries', () => {
  const cfg = JSON.parse(read('capacitor.config.json'));
  assert.equal(cfg.webDir, 'mobile-app', 'mobile bundles a dedicated minimal webDir, not the desktop `public/` tree');
  const dir = path.join(ROOT, 'mobile-app');
  const offenders = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.(exe|msi|dmg|AppImage)$/i.test(f));
  assert.deepEqual(offenders, [], 'no desktop installer binaries in the mobile webDir');
  // The public/ desktop artifacts must remain for web/Windows distribution (we exclude, not delete).
  assert.ok(fs.existsSync(path.join(ROOT, 'public/downloads')), 'web/Windows downloads folder preserved');
});

test('the local fallback boot page forwards to the real hosted origin (never a dead offline page)', () => {
  const cfg = JSON.parse(read('capacitor.config.json'));
  const html = read('mobile-app/index.html');
  const ORIGIN = cfg.server.url as string;
  // With server.url set, Capacitor's Bridge loads the remote origin directly (Bridge.java 626-644);
  // the bundled page is only a dormant fallback — so it MUST forward to the same origin, not strand
  // the user on "Connecting…".
  assert.ok(html.includes(ORIGIN), 'fallback forwards to the exact configured production origin');
  assert.ok(/location\.replace|http-equiv=["']refresh/i.test(html), 'fallback actively navigates to the production origin');
  // It must not be a self-contained fake landing (no local app shell / no localhost target).
  assert.ok(!/localhost|127\.0\.0\.1/.test(html), 'fallback never points at localhost');
});

test('the mobile shell stays Electron-free and reuses the shared /api contract (one brain)', () => {
  // src/ must not depend on Electron — that is the property that lets a plain
  // Capacitor WebView pointed at the hosted origin reuse the entire web app + /api.
  const offenders = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
    .map((f) => String(f))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => {
      try { return /from ['"]electron['"]|require\(['"]electron['"]\)/.test(read(path.join('src', f))); }
      catch { return false; }
    });
  assert.deepEqual(offenders, [], 'no Electron imports in src/ — mobile reuses the web core unchanged');
});
