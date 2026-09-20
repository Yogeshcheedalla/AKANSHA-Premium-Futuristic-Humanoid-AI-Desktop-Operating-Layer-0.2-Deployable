/**
 * DB-less desktop credential persistence: envelopes survive a process restart
 * via the local encrypted vault, raw secrets never appear in the file, and the
 * DB-mode key derivation is untouched (production envelopes stay valid).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

delete process.env.DATABASE_URL; // force DB-less desktop mode
delete process.env.AKANSHA_SECRET;
const HOME = mkdtempSync(join(tmpdir(), 'akan-vault-'));
process.env.AKANSHA_HOME = HOME;

// Static import (same directory): env is set above; paths resolve per call.
import { credentialVault, CredentialVault } from './CredentialVault';

test('desktop vault: put persists an ENCRYPTED envelope locally; raw secret not on disk', async () => {
  const ref = credentialVault.put('sk-or-super-secret-123456');
  await new Promise((r) => setTimeout(r, 50)); // persist() is fire-and-forget async
  const file = join(HOME, 'data', 'vault.json');
  assert.ok(existsSync(file), 'vault.json written');
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes('sk-or-super-secret-123456'), 'RAW SECRET MUST NOT BE ON DISK');
  assert.ok(raw.includes(ref), 'envelope stored under its ref');
  assert.equal(credentialVault.resolve(ref), 'sk-or-super-secret-123456');
});

test('desktop vault: a fresh instance (restart) hydrates and resolves the same secret', async () => {
  const fresh = new CredentialVault();
  const map = JSON.parse(readFileSync(join(HOME, 'data', 'vault.json'), 'utf8'));
  const ref = Object.keys(map)[0];
  assert.ok(ref, 'envelope exists on disk');
  await fresh.hydrate();
  assert.equal(fresh.resolve(ref), 'sk-or-super-secret-123456', 'secret recovered after restart');
});

test('desktop vault: machine key file exists (per-machine secret, not static fallback)', () => {
  assert.ok(existsSync(join(HOME, 'data', 'vault.key')), 'per-machine secret generated');
});
