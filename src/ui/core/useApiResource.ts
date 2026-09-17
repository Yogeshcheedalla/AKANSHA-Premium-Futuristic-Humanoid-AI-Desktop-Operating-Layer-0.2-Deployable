"use client";
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ApiResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  needsAuth: boolean;
  retry: () => void;
}

/**
 * Shared read-only fetch for authenticated workspaces. Fetches on mount (and on an
 * optional interval), aborts stale/slow requests, and distinguishes an auth failure
 * (401/403 → needsAuth) from a real error — so panels show honest empty/failed states
 * instead of fake data. All setState happens in async callbacks, never synchronously
 * in the effect body (keeps react-hooks lint clean).
 */
export function useApiResource<T>(
  url: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): ApiResource<T> {
  const { intervalMs, timeoutMs = 12000 } = opts;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const alive = useRef(true);

  const load = useCallback((signal?: AbortSignal) => {
    return fetch(url, { credentials: 'same-origin', signal })
      .then(async (r) => {
        const d: any = await r.json().catch(() => ({}));
        return { r, d };
      })
      .then(({ r, d }) => {
        if (!alive.current) return;
        if (r.status === 401 || r.status === 403) {
          setNeedsAuth(true); setError('Your session expired — sign in again to refresh this view.'); setLoading(false); return;
        }
        if (!r.ok || d?.ok === false) {
          setError(d?.error || `Request failed (HTTP ${r.status}).`); setLoading(false); return;
        }
        setData(d as T); setError(null); setNeedsAuth(false); setLoading(false);
      })
      .catch((e: any) => {
        if (!alive.current || e?.name === 'AbortError') return;
        setError(e?.message || 'Failed to load.'); setLoading(false);
      });
  }, [url]);

  useEffect(() => {
    alive.current = true;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    load(ctrl.signal);
    let iv: ReturnType<typeof setInterval> | undefined;
    if (intervalMs) {
      iv = setInterval(() => {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), timeoutMs);
        load(c.signal).finally(() => clearTimeout(t));
      }, intervalMs);
    }
    return () => {
      alive.current = false;
      clearTimeout(to); ctrl.abort();
      if (iv) clearInterval(iv);
    };
  }, [load, intervalMs, timeoutMs]);

  const retry = useCallback(() => { setLoading(true); setError(null); load(); }, [load]);

  return { data, loading, error, needsAuth, retry };
}
