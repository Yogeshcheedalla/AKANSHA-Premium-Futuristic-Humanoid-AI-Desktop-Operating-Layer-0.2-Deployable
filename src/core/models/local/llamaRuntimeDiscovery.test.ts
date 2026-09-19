import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultLlamaCandidates, detectLlamaRuntime } from './LocalGgufProvider';

const exe = process.platform === 'win32' ? 'llama-cli.exe' : 'llama-cli';

test('defaultLlamaCandidates always includes the repo/runtime dir', () => {
  const c = defaultLlamaCandidates();
  assert.ok(c.some((p) => p.endsWith(join('runtime', 'llama', exe))));
});

test('defaultLlamaCandidates includes AKANSHA_HOME + resourcesPath when set', () => {
  const prevHome = process.env.AKANSHA_HOME;
  const prevRes = (process as { resourcesPath?: string }).resourcesPath;
  try {
    process.env.AKANSHA_HOME = '/tmp/akan-home-test';
    (process as { resourcesPath?: string }).resourcesPath = '/opt/akan/resources';
    const c = defaultLlamaCandidates();
    assert.ok(c.includes(join('/tmp/akan-home-test', 'runtime', 'llama', exe)), 'AKANSHA_HOME candidate present');
    assert.ok(c.includes(join('/opt/akan/resources', 'runtime', 'llama', exe)), 'packaged resourcesPath candidate present');
  } finally {
    if (prevHome === undefined) delete process.env.AKANSHA_HOME; else process.env.AKANSHA_HOME = prevHome;
    (process as { resourcesPath?: string }).resourcesPath = prevRes;
  }
});

test('detectLlamaRuntime is existence-based — never assumes a runtime', () => {
  assert.equal(detectLlamaRuntime(['/nope/definitely/missing/llama-cli']).exists, false);
  const dir = mkdtempSync(join(tmpdir(), 'akan-llama-'));
  const f = join(dir, exe);
  try {
    writeFileSync(f, '');
    assert.equal(detectLlamaRuntime([f]).exists, true);
    assert.equal(detectLlamaRuntime([f]).binaryPath, f);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
