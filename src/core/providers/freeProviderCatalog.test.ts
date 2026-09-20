/**
 * AI Center / provider-catalog contract tests (spec §27 subset that lives in
 * the data + routing layer; UI states are exercised by the live verification).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FREE_PROVIDER_CATALOG, duplicateProviderIds, openAiCompatibleEntries } from './freeProviderCatalog';
import { WORKSPACES } from '@/ui/navigation/workspaces';

test('1/6 · catalog is pinned to a real source revision and preserves documented free-tier limits', () => {
  assert.match(FREE_PROVIDER_CATALOG.source, /^mnfst\/awesome-free-llm-apis$/);
  assert.match(FREE_PROVIDER_CATALOG.sourceRevision, /^[0-9a-f]{40}$/);
  assert.ok(FREE_PROVIDER_CATALOG.checkedAt > 0);
  const ovh = FREE_PROVIDER_CATALOG.providers.find((p) => p.providerId === 'ovhcloud')!;
  assert.match(ovh.freeTier || '', /anonymous/i);
  assert.match(ovh.models[0].rateLimit || '', /RPM/i); // limits preserved verbatim, not dropped
});

test('3 · no duplicate provider ids', () => {
  assert.deepEqual(duplicateProviderIds(), []);
});

test('2 · every entry: https base URL, real name, at least one documented model; unknowns stay unknown', () => {
  for (const p of FREE_PROVIDER_CATALOG.providers) {
    assert.match(p.baseUrl, /^https:\/\//);
    assert.ok(p.displayName.length > 1);
    assert.ok(p.models.length >= 1, `${p.providerId} has no models`);
    for (const m of p.models) assert.ok(m.name);
    // openAiCompatible must be TRUE or FALSE or ABSENT — never guessed into true:
    assert.ok(p.openAiCompatible === undefined || typeof p.openAiCompatible === 'boolean');
  }
});

test('4/8 · OpenAI-compatible subset routes through the existing provider type; others are not one-clickable', () => {
  const compat = openAiCompatibleEntries();
  assert.ok(compat.some((p) => p.providerId === 'openrouter'));
  assert.ok(compat.some((p) => p.providerId === 'groq'));
  assert.ok(compat.some((p) => p.providerId === 'ovhcloud'));
  assert.ok(compat.some((p) => p.providerId === 'ollama-cloud'));
  // keyless free fallback pool (the "second default") is all one-clickable:
  assert.ok(compat.some((p) => p.providerId === 'kilo' && p.requiresKey === false));
  assert.ok(compat.some((p) => p.providerId === 'llm7' && p.requiresKey === false));
  // Cloudflare documented as its own endpoint shape → excluded from one-click OpenAI connect:
  assert.ok(!compat.some((p) => p.providerId === 'cloudflare-workers-ai'));
  // Native-API providers stay manual (blanket note not trusted over known wire formats):
  assert.ok(!compat.some((p) => p.providerId === 'google-gemini'));
});

test('11 · no secret-like strings anywhere in the catalog', () => {
  const raw = JSON.stringify(FREE_PROVIDER_CATALOG);
  assert.ok(!/sk-[a-zA-Z0-9-]{20,}/.test(raw), 'no API keys in catalog data');
  assert.ok(!/Bearer\s+[A-Za-z0-9._-]{20,}/.test(raw));
});

test('2/§2 · navigation exposes AI Center, Models and Providers permanently', () => {
  const ids = WORKSPACES.map((w) => w.id);
  for (const need of ['aicenter', 'modelcenter', 'providers']) assert.ok(ids.includes(need), `missing ${need}`);
  const labels = WORKSPACES.map((w) => w.label);
  assert.ok(labels.includes('AI Center'));
  assert.ok(labels.includes('Models'));
});

test('catalog route requires a session (no anonymous catalog/status reads)', async () => {
  const prev = process.env.AKANSHA_AUTH_DISABLED;
  delete process.env.AKANSHA_AUTH_DISABLED;
  const prevToken = process.env.AKANSHA_ACCESS_TOKEN;
  delete process.env.AKANSHA_ACCESS_TOKEN;
  try {
    const { GET } = await import('@/app/api/providers/catalog/route');
    const res = await GET(new Request('http://localhost/api/providers/catalog'));
    assert.equal(res.status, 401);
  } finally {
    if (prev !== undefined) process.env.AKANSHA_AUTH_DISABLED = prev;
    if (prevToken !== undefined) process.env.AKANSHA_ACCESS_TOKEN = prevToken;
  }
});

test('catalog route returns normalized providers + live status fields', async () => {
  process.env.AKANSHA_AUTH_DISABLED = 'true';
  try {
    const { GET } = await import('@/app/api/providers/catalog/route');
    const res = await GET(new Request('http://localhost/api/providers/catalog'));
    const j: any = await res.json();
    assert.equal(j.ok, true);
    assert.ok(Array.isArray(j.providers) && j.providers.length >= 10);
    for (const p of j.providers) {
      assert.ok(['NOT_CONFIGURED', 'CONFIGURED', 'DISABLED', 'AVAILABLE', 'AUTH_REQUIRED', 'RATE_LIMITED', 'UNAVAILABLE', 'UNKNOWN'].includes(p.status), p.status);
      assert.equal(typeof p.connected, 'boolean');
    }
    assert.match(j.attribution, /awesome-free-llm-apis/);
  } finally {
    delete process.env.AKANSHA_AUTH_DISABLED;
  }
});
