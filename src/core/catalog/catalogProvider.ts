/**
 * Catalog provider — the ONE place that sources the ModelCatalog the UI consumes,
 * so the Model Center is never a hard-coded list. It reads a signed catalog file +
 * verifies it against a configured Ed25519 public key (ModelCatalog.validateSignedCatalog).
 *
 * PRODUCTION/DEVELOPMENT SEPARATION (explicit, not filename-based):
 *   - In production (allowFixture=false, the default) ONLY the configured signed
 *     catalog is trusted. A catalog marked `fixture:true` is REJECTED as
 *     'fixture-in-production'. Absent a real catalog it reports 'not-configured'
 *     honestly — the UI shows "catalog not configured", never a fabricated list.
 *   - The DEV fixture catalog loads ONLY when an explicit flag is set:
 *     NODE_ENV==='development' AND AKANSHA_ALLOW_FIXTURE_CATALOG==='1' (or the
 *     caller passes allowFixture=true). Then, with no real catalog, it yields a
 *     self-signed 'fixture' catalog so the UI + state machine can be exercised.
 *   - A fixture NEVER becomes usable — usable is gated elsewhere on real inference.
 */
import { readFileSync } from 'node:fs';
import { validateSignedCatalog, type CatalogModel, type SignedCatalog } from '@/core/catalog/ModelCatalog';
import { buildFixtureCatalog } from '@/core/catalog/fixtureCatalog';

export type CatalogStatus = 'ready' | 'fixture' | 'not-configured' | 'invalid';
export interface CatalogResult { status: CatalogStatus; models: CatalogModel[]; reasons: string[] }

function readMaybe(path?: string): string | null {
  if (!path) return null;
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

/** The security boundary: an explicit env flag, not a filename. */
export function fixtureAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env.NODE_ENV || env.AKANSHA_ENV || '';
  return mode === 'development' && env.AKANSHA_ALLOW_FIXTURE_CATALOG === '1';
}

/**
 * @param env injectable (tests). Production: AKANSHA_MODEL_CATALOG = path to the
 * signed catalog JSON; AKANSHA_CATALOG_PUBKEY = PEM, or AKANSHA_CATALOG_PUBKEY_FILE.
 * @param allowFixtureOverride forces the decision (tests); default derived from env.
 */
export function loadSignedCatalog(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
  allowFixtureOverride?: boolean,
): CatalogResult {
  const allowFixture = allowFixtureOverride ?? fixtureAllowed(env);
  const catalogRaw = readMaybe(env.AKANSHA_MODEL_CATALOG);
  const publicKeyPem = env.AKANSHA_CATALOG_PUBKEY || readMaybe(env.AKANSHA_CATALOG_PUBKEY_FILE);

  if (catalogRaw && publicKeyPem) {
    let signed: SignedCatalog;
    try { signed = JSON.parse(catalogRaw) as SignedCatalog; }
    catch (e: any) { return { status: 'invalid', models: [], reasons: ['unreadable-catalog:' + (e?.message || e)] }; }
    // Production must never trust a fixture-marked catalog, even if it verifies.
    if (signed.catalog?.fixture === true && !allowFixture) {
      return { status: 'invalid', models: [], reasons: ['fixture-in-production'] };
    }
    const v = validateSignedCatalog(signed, publicKeyPem, now);
    if (!v.ok) return { status: 'invalid', models: [], reasons: v.reasons };
    return { status: signed.catalog.fixture === true ? 'fixture' : 'ready', models: v.models, reasons: [] };
  }

  // No real catalog configured.
  if (allowFixture) {
    const fx = buildFixtureCatalog(now);
    const v = validateSignedCatalog(fx.signed, fx.publicKeyPem, now);
    if (!v.ok) return { status: 'invalid', models: [], reasons: ['fixture-invalid:' + v.reasons.join(',')] };
    return { status: 'fixture', models: v.models, reasons: [] };
  }

  return { status: 'not-configured', models: [], reasons: ['no signed catalog + public key configured'] };
}
