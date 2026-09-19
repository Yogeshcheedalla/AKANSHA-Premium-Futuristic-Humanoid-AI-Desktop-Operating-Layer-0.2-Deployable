/**
 * Bundled signed production catalog — statically imported so the packaged
 * desktop server ALWAYS carries it. The previous fallback read the JSON + the
 * public key via fs at runtime, but Next's build-time file tracing does not
 * follow readFileSync paths, so the SHIPPED win-unpacked app reported
 * MODEL CATALOG NOT-CONFIGURED. Static imports land both artifacts in the
 * compiled server chunk — same bytes, same Ed25519 signature verification,
 * same code path for every load (nothing is trusted more than before).
 *
 * The private signing key remains only under gitignored .akansha-keys/.
 */
import type { SignedCatalog } from './ModelCatalog';
import catalogJson from './catalog.production.json';

export const BUNDLED_CATALOG_PUB_PEM =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MCowBQYDK2VwAyEA9ladpAhhujBK+trG3Y3hS6wfmJaG/3CNv1v5zEb7wwg=\n' +
  '-----END PUBLIC KEY-----\n';

export const BUNDLED_SIGNED_CATALOG = catalogJson as unknown as SignedCatalog;
