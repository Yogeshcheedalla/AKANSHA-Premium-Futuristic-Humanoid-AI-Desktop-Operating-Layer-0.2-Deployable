/**
 * User trust store + storage removal + voice-selection tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate the trust store (the store path is resolved per call from env).
process.env.AKANSHA_HOME = mkdtempSync(join(tmpdir(), 'akan-trust-'));
import { trustModelRepo, readUserCatalog, untrustModel } from '@/core/models/local/userCatalog';
import { chooseFemaleVoice } from '@/ui/voice/AudioEngine';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const fakeHf = (files: any[], extra: any = {}) => async () => ({
  ok: true, status: 200,
  json: async () => ({ siblings: files, tags: ['gguf', 'license:mit'], gguf: { architecture: 'qwen2', total: 1.5e9, context_length: 32768 }, cardData: { license: 'mit' }, ...extra }),
});

test('trust pins the REAL LFS sha256 and prefers the Q4_K_M artifact', async () => {
  const r = await trustModelRepo('Some/Model-GGUF', {
    fetcher: fakeHf([
      { rfilename: 'model-Q8_0.gguf', size: 1.7e9, lfs: { sha256: SHA_B } },
      { rfilename: 'model-Q4_K_M.gguf', size: 1.1e9, lfs: { sha256: SHA_A } },
      { rfilename: 'README.md', size: 10 },
    ]) as any,
  });
  assert.equal(r.ok, true);
  assert.equal(r.selectedFile, 'model-Q4_K_M.gguf');
  assert.equal(r.entry!.sha256, SHA_A);
  assert.equal(r.entry!.downloadSizeBytes, 1.1e9);
  assert.equal(r.entry!.format, 'gguf');
  assert.equal(r.entry!.runtimeRequirement, 'llama.cpp');
  assert.equal(r.entry!.family, 'qwen');            // from structured gguf.architecture
  assert.equal(r.entry!.contextLength, 32768);      // real metadata, not guessed
  assert.equal(r.entry!.quantization, undefined);   // NEVER inferred from the file name
  assert.ok(readUserCatalog().some((m) => m.id === r.entry!.id));
});

test('trust REFUSES artifacts without a verifiable LFS SHA-256 (no inferred checksums)', async () => {
  const r = await trustModelRepo('Sketchy/Repo-GGUF', {
    fetcher: fakeHf([{ rfilename: 'x-Q4_K_M.gguf', size: 1e9 }]) as any, // no lfs at all
  });
  assert.equal(r.ok, false);
  assert.match(r.reason || '', /verifiable|SHA-256/i);
});

test('trust refuses artifacts above the 8 GB ceiling and malformed repos', async () => {
  const big = await trustModelRepo('Huge/Repo-GGUF', {
    fetcher: fakeHf([{ rfilename: 'huge-Q4_K_M.gguf', size: 30e9, lfs: { sha256: SHA_A } }]) as any,
  });
  assert.equal(big.ok, false);
  const bad = await trustModelRepo('not-a-repo', { fetcher: fakeHf([]) as any });
  assert.equal(bad.ok, false);
});

test('untrust removes the approval entry', async () => {
  const r = await trustModelRepo('Temp/Repo-GGUF', {
    fetcher: fakeHf([{ rfilename: 't-Q4_K_M.gguf', size: 2e9, lfs: { sha256: SHA_A } }]) as any,
  });
  assert.equal(r.ok, true);
  untrustModel(r.entry!.id);
  assert.ok(!readUserCatalog().some((m) => m.id === r.entry!.id));
});

/* ── female voice selection (the "male voice" bug) ──────────────────────── */
const v = (name: string, lang: string): SpeechSynthesisVoice => ({ name, lang } as SpeechSynthesisVoice);

test('voice choice prefers a FEMALE English voice over the OS default order', () => {
  const voices = [v('Microsoft David Desktop', 'en-US'), v('Microsoft Aria (Natural) Online (Natural)', 'en-US'), v('Microsoft Zira Desktop', 'en-US')];
  assert.equal(chooseFemaleVoice(voices)!.name.includes('Aria'), true);
});

test('empty voice list (Chromium async load) yields null → caller must retry after voiceschanged', () => {
  assert.equal(chooseFemaleVoice([]), null);
});

test('falls back to any en voice, then first, never crashes', () => {
  assert.equal(chooseFemaleVoice([v('Heer', 'hi-IN'), v('Sonia', 'en-GB')])!.name, 'Sonia');
  assert.equal(chooseFemaleVoice([v('Heer', 'hi-IN')])!.name, 'Heer');
});

test('cleanup', () => { try { rmSync(process.env.AKANSHA_HOME!, { recursive: true, force: true }); } catch { /* temp */ } });
