/**
 * Testable loader for the Repository Fabric data.
 *
 * Kept free of React so its timeout / non-ok / network-failure behavior can be
 * unit-tested. It NEVER leaves a caller in an indeterminate state: it always
 * resolves to either { ok:true, data } or { ok:false, error } — which is exactly
 * what prevents the old "Mapping repository fabric…" infinite spinner.
 */
export interface RepositoriesResult {
  ok: boolean;
  [k: string]: unknown;
}

export type LoadResult =
  | { ok: true; data: RepositoriesResult }
  | { ok: false; error: string };

export async function loadRepositories(
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = 12000
): Promise<LoadResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl('/api/repositories', { signal: ctrl.signal, credentials: 'same-origin' });
    const d = await res.json().catch(() => ({} as RepositoriesResult));
    if (!res.ok || !d || d.ok !== true) {
      const msg = (d && typeof d.error === 'string' && d.error) || (res.status === 401 ? 'Authentication required' : `Request failed (HTTP ${res.status})`);
      return { ok: false, error: msg };
    }
    return { ok: true, data: d };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, error: `Timed out after ${Math.round(timeoutMs / 1000)}s — the repository service did not respond in time.` };
    return { ok: false, error: e?.message || 'Failed to load the repository fabric.' };
  } finally {
    clearTimeout(timer);
  }
}
