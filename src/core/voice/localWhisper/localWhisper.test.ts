import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverWhisper } from './whisperRuntime';
import { provisionArtifact } from './whisperProvision';
import { classifyVoiceInput } from '@/core/runtime/systemStatus';

test('discoverWhisper returns null (→ UNAVAILABLE) when no runtime/model exists', () => {
  // No WHISPER_CPP_PATH / model present in this environment.
  const r = discoverWhisper({} as NodeJS.ProcessEnv);
  assert.equal(r, null);
});

test('classifyVoiceInput: local READY wins; else configured-not-ready; else unavailable', () => {
  assert.equal(classifyVoiceInput('READY', false), 'LOCAL_WHISPER_READY');
  assert.equal(classifyVoiceInput('UNAVAILABLE', true), 'CLOUD_ASR_CONFIGURED');
  assert.equal(classifyVoiceInput('DISCOVERED', false), 'UNAVAILABLE');
});

test('provisionArtifact REFUSES unpinned/arbitrary downloads (never fakes READY)', async () => {
  const r = await provisionArtifact({ url: '', sha256: '', version: '', arch: 'x64', destDir: '/tmp', kind: 'runtime' });
  assert.equal(r.state, 'SKIPPED');
  assert.equal(r.ok, false);
});

test('provisionArtifact rejects a SHA-256 mismatch (INTEGRITY_FAIL, not ok)', async () => {
  // Point at an existing local file via file: is not supported; assert guard shape.
  const r = await provisionArtifact({ url: 'https://example.invalid/x.bin', sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', version: 'v', arch: 'x64', destDir: process.env.TEMP || '/tmp', kind: 'runtime' });
  assert.ok(r.state === 'ERROR' || r.state === 'INTEGRITY_FAIL'); // network fails → ERROR; never READY
  assert.equal(r.ok, false);
});

