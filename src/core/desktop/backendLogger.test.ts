import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
// @ts-ignore - plain CommonJS helper under electron/
import { createBackendLogger } from '../../../electron/backendLogger.js';

function tmpDir(name: string) {
  const d = path.join(os.tmpdir(), `akan-log-${name}-${Date.now()}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

test('backend logger writes structured lines to backend.log', () => {
  const d = tmpDir('basic');
  const log = createBackendLogger(d);
  log.info('spawn_plan', { port: 4321, packaged: true });
  const content = fs.readFileSync(path.join(d, 'backend.log'), 'utf8');
  assert.ok(/"event":"spawn_plan"/.test(content), 'event recorded');
  assert.ok(/"port":4321/.test(content), 'data recorded');
});

test('backend logger REDACTS secrets (keys + Bearer/GOCSPX/sk- values)', () => {
  const d = tmpDir('redact');
  const log = createBackendLogger(d);
  log.info('spawn', { AKANSHA_ACCESS_TOKEN: 'super-secret-token', note: 'auth Bearer abcdef123456 and GOCSPX-REALSECRETVALUE and sk-abcdefghijklmnopqrst' });
  const raw = fs.readFileSync(path.join(d, 'backend.log'), 'utf8');
  assert.ok(!raw.includes('super-secret-token'), 'secret-valued key redacted');
  assert.ok(!raw.includes('GOCSPX-REALSECRETVALUE'), 'GOCSPX value redacted');
  assert.ok(!raw.includes('abcdefghijklmnopqrst'), 'sk- value redacted');
  assert.ok(!raw.includes('abcdef123456'), 'Bearer token redacted');
});

test('backend logger ROTATES at the size cap (backend.log -> backend.log.1)', () => {
  const d = tmpDir('rotate');
  const log = createBackendLogger(d, { maxBytes: 400 });
  for (let i = 0; i < 60; i++) log.info('tick', { i, pad: 'x'.repeat(40) });
  assert.ok(fs.existsSync(path.join(d, 'backend.log.1')), 'rotated file created');
  assert.ok(fs.existsSync(path.join(d, 'backend.log')), 'current file present');
});

test('diagnosticReport is redacted and never throws when no log exists', () => {
  const d = tmpDir('report');
  const empty = createBackendLogger(d);
  assert.match(empty.diagnosticReport(), /no log/i);
  empty.info('boom', { token: 'leak-me' });
  const rep = empty.diagnosticReport();
  assert.ok(!rep.includes('leak-me'), 'report is redacted');
});
