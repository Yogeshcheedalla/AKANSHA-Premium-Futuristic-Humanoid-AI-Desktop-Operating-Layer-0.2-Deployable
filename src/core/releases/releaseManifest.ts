/**
 * Truth-driven release manifest.
 *
 * One authoritative source for "is there a real, downloadable artifact for this
 * platform?" Availability is NEVER invented — it is derived by a live HEAD (or a
 * minimal Range GET fallback) against the configured artifact URL. We never stream
 * hundreds of megabytes during a landing request; we only read status +
 * Content-Length. If a URL is absent, unreachable, non-2xx, or zero-length, the
 * artifact is available:false and the landing shows "Coming soon / Build required"
 * instead of a button that 404s.
 *
 * Configuration is env-driven (GitHub Releases / CDN / object storage later):
 *   AKANSHA_RELEASES = JSON array of
 *     { platform, architecture, type, filename, url, sha256?, version? }
 * With no configuration, the manifest is honestly empty → nothing is downloadable.
 *
 * The local public/downloads/*.exe are NOT treated as production-downloadable
 * merely because they exist on disk (they are .vercelignore-excluded from the web
 * build anyway).
 */
export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios';

export interface ReleaseArtifactConfig {
  platform: Platform;
  architecture?: string;
  type?: string;            // installer | portable | apk | dmg | appimage | deb
  filename?: string;
  url: string;
  sha256?: string;
  version?: string;
}

export interface VerifiedRelease extends ReleaseArtifactConfig {
  available: boolean;
  size: number | null;
  verifiedAt: string;
  reason?: string;
}

function parseConfigured(env: NodeJS.ProcessEnv): ReleaseArtifactConfig[] {
  const raw = env.AKANSHA_RELEASES?.trim();
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((a: any) => a && typeof a.url === 'string' && typeof a.platform === 'string');
  } catch {
    return [];
  }
}

/** HEAD (or Range GET fallback). Returns availability + size without downloading. */
export async function verifyArtifact(
  artifact: ReleaseArtifactConfig,
  fetcher: typeof fetch = globalThis.fetch,
  timeoutMs = 6000
): Promise<VerifiedRelease> {
  const base = { ...artifact, verifiedAt: new Date().toISOString() };
  try {
    const head = await fetcher(artifact.url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const len = Number(head.headers.get('content-length') || '0');
    if (head.ok && len > 0) return { ...base, available: true, size: len };
    if (head.status === 405 || head.status === 501) {
      // Server rejects HEAD → do a 1-byte range GET (never the whole file).
      const g = await fetcher(artifact.url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      const cr = /bytes\s+\d+-\d+\/(\d+)/i.exec(g.headers.get('content-range') || '');
      const total = cr ? Number(cr[1]) : Number(g.headers.get('content-length') || '0');
      const ok = (g.status === 206 || g.status === 200) && total > 0;
      return { ...base, available: ok, size: ok ? total : null, reason: ok ? undefined : `range-status-${g.status}` };
    }
    return { ...base, available: false, size: head.ok ? (len > 0 ? len : null) : null, reason: `http-${head.status}` };
  } catch (e: any) {
    return { ...base, available: false, size: null, reason: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  }
}

// Tiny module cache so we never hammer artifact hosts on every landing hit.
const CACHE_MS = 60_000;
let cache: { at: number; key: string; value: VerifiedRelease[] } | null = null;

export async function getReleases(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = globalThis.fetch
): Promise<{ version: string; releases: VerifiedRelease[] }> {
  const configured = parseConfigured(env);
  const version = env.npm_package_version || env.AKANSHA_VERSION || '3.0.0';
  const key = JSON.stringify(configured);
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) {
    return { version, releases: cache.value };
  }
  const releases = configured.length === 0
    ? []
    : await Promise.all(configured.map((a) => verifyArtifact(a, fetcher)));
  cache = { at: Date.now(), key, value: releases };
  return { version, releases };
}

/** Test hook / forced refresh. */
export function clearReleaseCache() { cache = null; }
