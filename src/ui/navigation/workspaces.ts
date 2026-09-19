/**
 * Single source of truth for the authenticated app's left-side navigation.
 *
 * Both the dock (FloatingDock) and the workspace switch (AppClient) derive from
 * this list, and the URL route (useWorkspaceRoute) validates against it, so a
 * nav item and its rendered panel can never silently drift out of sync again
 * (this previously allowed an orphan 'devops' case with no dock entry).
 */
export interface WorkspaceMeta {
  id: string;
  label: string;
}

/** Ordered exactly as shown top→bottom in the left dock. */
export const WORKSPACES: WorkspaceMeta[] = [
  { id: 'command', label: 'Command' },
  { id: 'search', label: 'Web Search' },
  { id: 'cognitive', label: 'Cognitive Layer' },
  { id: 'missions', label: 'Missions' },
  { id: 'repositories', label: 'Repository Fabric' },
  { id: 'agents', label: 'Agents' },
  { id: 'integrations', label: 'Capability Fabric' },
  { id: 'providers', label: 'AI Providers' },
  { id: 'modelcenter', label: 'Model Center' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'memory', label: 'Memory' },
  { id: 'security', label: 'Security' },
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'settings', label: 'Settings' },
];

export const DEFAULT_WORKSPACE = 'command';

const VALID = new Set(WORKSPACES.map((w) => w.id));

export function isValidWorkspace(id: string | null | undefined): id is string {
  return !!id && VALID.has(id);
}
