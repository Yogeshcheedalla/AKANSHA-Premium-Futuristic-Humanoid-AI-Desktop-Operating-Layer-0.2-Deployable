"use client";
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_WORKSPACE, isValidWorkspace } from './workspaces';

/**
 * The active workspace is mirrored to the URL hash (#/app/<id>) so browser
 * refresh, Back/Forward, and a shared deep link all land on the SAME panel.
 * Pure + DOM-free so it is unit-testable without a browser environment.
 */
export function workspaceFromHash(hash: string | undefined | null): string | null {
  const m = /^#\/app\/([a-z0-9-]+)/i.exec(String(hash || ''));
  if (!m) return null;
  return isValidWorkspace(m[1]) ? m[1] : null;
}

const hashFor = (id: string) => `#/app/${id}`;

/** Read the initial workspace straight from the hash (handles refresh + deep link). */
function initialWorkspace(): string {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE;
  return workspaceFromHash(window.location.hash) || DEFAULT_WORKSPACE;
}

export function useWorkspaceRoute() {
  const [workspace, setWorkspace] = useState<string>(initialWorkspace);

  // Ensure the URL always carries a valid #/app/<id> WITHOUT adding a history entry.
  // Only touches history — never setState — so it does not cause a cascading render.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = workspaceFromHash(window.location.hash) || DEFAULT_WORKSPACE;
    if (window.location.hash !== hashFor(target)) {
      window.history.replaceState(null, '', hashFor(target));
    }
  }, []);

  // Back / Forward restore the panel from the URL (setState lives in the listener,
  // the sanctioned "subscribe to an external system" pattern, not the effect body).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onNavigate = () => setWorkspace(workspaceFromHash(window.location.hash) || DEFAULT_WORKSPACE);
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('hashchange', onNavigate);
    return () => {
      window.removeEventListener('popstate', onNavigate);
      window.removeEventListener('hashchange', onNavigate);
    };
  }, []);

  const select = useCallback((id: string) => {
    const next = isValidWorkspace(id) ? id : DEFAULT_WORKSPACE;
    setWorkspace(next);
    if (typeof window !== 'undefined' && window.location.hash !== hashFor(next)) {
      window.history.pushState(null, '', hashFor(next));
    }
  }, []);

  return { workspace, select };
}
