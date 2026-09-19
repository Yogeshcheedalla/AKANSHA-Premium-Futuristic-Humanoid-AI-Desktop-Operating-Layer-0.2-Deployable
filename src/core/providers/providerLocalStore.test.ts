/**
 * DB-less provider persistence (packaged desktop): addProvider/update/remove
 * round-trip through the local JSON store with vault refs — never raw keys —
 * and survive a fresh manager instance (app restart).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

delete process.env.DATABASE_URL; // force the local fallback path (isDbConfigured=false)
const HOME = mkdtempSync(join(tmpdir(), 'akan-prov-'));
process.env.AKANSHA_HOME = HOME;

// Static import: isDbConfigured is evaluated at module load, AFTER the deletes above.
import { ProviderManager } from './ProviderManager';
import { credentialVault } from '../security/CredentialVault';

const MGR = () => new ProviderManager();

test('addProvider persists to the local store with a VAULT REF (never the raw key)', async () => {
  const m = MGR();
  const rec = await m.addProvider({ id: 'openrouter', name: 'OpenRouter (Cloud)', type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-test-123', defaultModel: 'openrouter/auto' } as any);
  assert.equal(rec.providerId, 'openrouter');
  assert.equal(rec.credentialConfigured, true);
  const file = join(HOME, 'data', 'providers.json');
  assert.ok(existsSync(file), 'local provider store written');
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes('sk-or-test-123'), 'RAW SECRET MUST NEVER HIT DISK');
  const row = JSON.parse(raw).rows.find((r: any) => r.providerId === 'openrouter');
  assert.ok(row.credentialRef, 'vault ref stored');
  assert.equal(credentialVault.resolve(row.credentialRef), 'sk-or-test-123');
});

test('a fresh manager instance (restart) loads the persisted provider', async () => {
  const m = MGR();
  await m.load();
  const rec = await m.getRecord('openrouter');
  assert.ok(rec, 'provider survived restart');
  assert.equal(rec!.defaultModel, 'openrouter/auto');
});

test('updateProvider (toggle off) persists; disabled providers still LIST; remove deletes custom rows and reverts built-ins', async () => {
  const m = MGR();
  await m.load();
  const upd = await m.updateProvider('openrouter', { enabled: false });
  // Disabled providers are NOT instantiated (not routed to) — getRecord is null —
  // but listRecords must still show them (the card must not vanish on toggle).
  assert.equal(upd, null);
  const m2 = MGR();
  await m2.load();
  const listed = (await m2.listRecords()).find((r) => r.providerId === 'openrouter');
  assert.ok(listed, 'disabled provider still listed');
  assert.equal(listed!.enabled, false, 'toggle persists across restart');
  assert.equal(listed!.credentialConfigured, true, 'vault ref survives disable');

  // a CUSTOM provider is fully removed…
  await m2.addProvider({ id: 'my-llm', name: 'My LLM', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1' } as any);
  await m2.removeProvider('my-llm');
  const m3 = MGR();
  await m3.load();
  assert.ok(!(await m3.listRecords()).some((r) => r.providerId === 'my-llm'), 'custom provider gone after remove');

  // …while removing a BUILT-IN reverts it to its default seed (by design).
  await m3.removeProvider('openrouter');
  const m4 = MGR();
  await m4.load();
  const back = (await m4.listRecords()).find((r) => r.providerId === 'openrouter');
  assert.ok(back, 'built-in returns from seed');
  assert.equal(back!.credentialConfigured, false, 'removed key does NOT come back');
});

test('cleanup', () => { try { rmSync(HOME, { recursive: true, force: true }); } catch { /* temp */ } });
