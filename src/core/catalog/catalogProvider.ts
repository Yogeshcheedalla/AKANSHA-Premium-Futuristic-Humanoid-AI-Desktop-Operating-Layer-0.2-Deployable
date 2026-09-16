/**
 * Catalog provider — the ONE place that sources the signed ModelCatalog the UI
 * consumes, so the Model Center is never a hard-coded list. It reads a signed
 * catalog file + verifies it against a configured Ed25519 public key, reusing
 * ModelCatalog.validateSignedCatalog. If either is absent it reports
 * 'not-configured' honestly — the UI must then show "catalog not configured",
 * never a fabricated model list, and never trust an unsigned catalog.
 */
import { readFileSync } from 'node:fs';
import { validateSignedCatalog, type CatalogModel, type SignedCatalog } from '@/core/catalog/ModelCatalog';

export type CatalogStatus = 'ready' | 'not-configured' | 'invalid';
export interface CatalogResult { status: CatalogStatus; models: CatalogModel[]; reasons: string[] }

function readMaybe(path?: string): string | null {
  if (!path) return null;
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

/**
 * @param env injectable (tests). Production: AKANSHA_MODEL_CATALOG = path to the
 * signed catalog JSON; AKANSHA_CATALOG_PUBKEY = PEM, or AKANSHA_CATALOG_PUBKEY_FILE = path to it.
 */
export function loadSignedCatalog(env: NodeJS.ProcessEnv = process.env, now = Date.now()): CatalogResult {
  const catalogRaw = readMaybe(env.AKANSHA_MODEL_CATALOG);
  const publicKeyPem = env.AKANSHA_CATALOG_PUBKEY || readMaybe(env.AKANSHA_CATALOG_PUBKEY_FILE);

  if (!catalogRaw || !publicKeyPem) {
    return { status: 'not-configured', models: [], reasons: ['no signed catalog + public key configured'] };
  }
  let signed: SignedCatalog;
  try { signed = JSON.parse(catalogRaw) as SignedCatalog; }
  catch (e: any) { return { status: 'invalid', models: [], reasons: ['unreadable-catalog:' + (e?.message || e)] }; }

  const v = validateSignedCatalog(signed, publicKeyPem, now);
  return v.ok ? { status: 'ready', models: v.models, reasons: [] } : { status: 'invalid', models: [], reasons: v.reasons };
}
