import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { hashFileSync } from '@/core/releases/artifactIntegrity';

test('hashFileSync: measures a REAL sha256 + size from disk (multi-buffer, streamed)', () => {
  const file = path.join(os.tmpdir(), `akan-integrity-${Date.now()}.bin`);
  // ~2.5 MB of pseudorandom bytes so the streaming loop crosses the 1 MB buffer.
  const data = crypto.randomBytes(1024 * 1024 * 3);
  fs.writeFileSync(file, data);
  try {
    const expected = crypto.createHash('sha256').update(data).digest('hex');
    const got = hashFileSync(file);
    assert.equal(got.sha256, expected.toLowerCase(), 'sha256 matches an independent hash of the same bytes');
    assert.equal(got.size, data.length, 'byte size matches the file length');
    assert.equal(got.sha256.length, 64);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('hashFileSync: different content yields a different hash (no collision/caching bug)', () => {
  const a = path.join(os.tmpdir(), `akan-a-${Date.now()}.bin`);
  const b = path.join(os.tmpdir(), `akan-b-${Date.now()}.bin`);
  fs.writeFileSync(a, 'akansha');
  fs.writeFileSync(b, 'akansha!');
  try {
    assert.notEqual(hashFileSync(a).sha256, hashFileSync(b).sha256);
  } finally {
    fs.rmSync(a, { force: true }); fs.rmSync(b, { force: true });
  }
});
