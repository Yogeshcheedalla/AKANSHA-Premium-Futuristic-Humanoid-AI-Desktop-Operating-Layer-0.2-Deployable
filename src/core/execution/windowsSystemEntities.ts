/**
 * Windows system-entity resolver — the canonical layer that runs BEFORE
 * installed-app discovery and web navigation. It prevents the class of bug where
 * "open files" fuzzy-matched VLC or "open settings" fabricated settings.com.
 *
 * Rule: a generic Windows SYSTEM entity resolves to its native capability first.
 * Web navigation is only for an explicit web target (a known site or a real
 * domain). Only capabilities that can actually be executed AND verified are
 * listed; anything else stays unresolved rather than guessed.
 */
export interface WindowsSystemTarget {
  capability: string;
  executable: string;      // passed to the existing launchResolved executor
  args: string[];
  processName: string;     // for observation/verification
  titleHint: string;       // window-title regex for verification
  label: string;
}

// alias → target. Keys are normalized (lowercase, single-spaced).
const SYSTEM_ENTITIES: Record<string, WindowsSystemTarget> = {
  'files': { capability: 'desktop.fileManager.open', executable: 'explorer.exe', args: [], processName: 'explorer', titleHint: 'explorer|this pc|documents|file explorer', label: 'File Explorer' },
  'file explorer': { capability: 'desktop.fileManager.open', executable: 'explorer.exe', args: [], processName: 'explorer', titleHint: 'explorer|this pc|documents|file explorer', label: 'File Explorer' },
  'windows explorer': { capability: 'desktop.fileManager.open', executable: 'explorer.exe', args: [], processName: 'explorer', titleHint: 'explorer|this pc|documents', label: 'File Explorer' },
  'explorer': { capability: 'desktop.fileManager.open', executable: 'explorer.exe', args: [], processName: 'explorer', titleHint: 'explorer|this pc|documents', label: 'File Explorer' },
  'my files': { capability: 'desktop.fileManager.open', executable: 'explorer.exe', args: [], processName: 'explorer', titleHint: 'explorer|this pc|documents', label: 'File Explorer' },
  'this pc': { capability: 'desktop.fileManager.open', executable: 'explorer.exe', args: ['shell:ThisPC'], processName: 'explorer', titleHint: 'this pc|explorer', label: 'This PC' },

  'settings': { capability: 'desktop.settings.open', executable: 'explorer.exe', args: ['ms-settings:'], processName: 'systemsettings', titleHint: 'settings', label: 'Windows Settings' },
  'windows settings': { capability: 'desktop.settings.open', executable: 'explorer.exe', args: ['ms-settings:'], processName: 'systemsettings', titleHint: 'settings', label: 'Windows Settings' },
  'system settings': { capability: 'desktop.settings.open', executable: 'explorer.exe', args: ['ms-settings:'], processName: 'systemsettings', titleHint: 'settings', label: 'Windows Settings' },
  'network settings': { capability: 'desktop.settings.network', executable: 'explorer.exe', args: ['ms-settings:network'], processName: 'systemsettings', titleHint: 'settings', label: 'Network Settings' },
  'bluetooth settings': { capability: 'desktop.settings.bluetooth', executable: 'explorer.exe', args: ['ms-settings:bluetooth'], processName: 'systemsettings', titleHint: 'settings', label: 'Bluetooth Settings' },
  'display settings': { capability: 'desktop.settings.display', executable: 'explorer.exe', args: ['ms-settings:display'], processName: 'systemsettings', titleHint: 'settings', label: 'Display Settings' },
  'sound settings': { capability: 'desktop.settings.sound', executable: 'explorer.exe', args: ['ms-settings:sound'], processName: 'systemsettings', titleHint: 'settings', label: 'Sound Settings' },

  'control panel': { capability: 'desktop.controlPanel.open', executable: 'explorer.exe', args: ['control'], processName: 'explorer', titleHint: 'control panel', label: 'Control Panel' },
  'task manager': { capability: 'desktop.taskManager.open', executable: 'taskmgr.exe', args: [], processName: 'taskmgr', titleHint: 'task manager', label: 'Task Manager' },

  'downloads': { capability: 'desktop.folder.open', executable: 'explorer.exe', args: ['shell:Downloads'], processName: 'explorer', titleHint: 'downloads', label: 'Downloads' },
  'documents': { capability: 'desktop.folder.open', executable: 'explorer.exe', args: ['shell:Documents'], processName: 'explorer', titleHint: 'documents', label: 'Documents' },
  'pictures': { capability: 'desktop.folder.open', executable: 'explorer.exe', args: ['shell:Pictures'], processName: 'explorer', titleHint: 'pictures', label: 'Pictures' },
  'music': { capability: 'desktop.folder.open', executable: 'explorer.exe', args: ['shell:Music'], processName: 'explorer', titleHint: 'music', label: 'Music' },
  'videos': { capability: 'desktop.folder.open', executable: 'explorer.exe', args: ['shell:Videos'], processName: 'explorer', titleHint: 'videos', label: 'Videos' },
  'desktop': { capability: 'desktop.location.open', executable: 'explorer.exe', args: ['shell:Desktop'], processName: 'explorer', titleHint: 'desktop', label: 'Desktop' },
  'recycle bin': { capability: 'desktop.recycleBin.open', executable: 'explorer.exe', args: ['shell:RecycleBinFolder'], processName: 'explorer', titleHint: 'recycle bin', label: 'Recycle Bin' },
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/\b(the|my|to|a)\b/g, ' ').replace(/\s+/g, ' ').trim();

/** Resolve a bare entity to a Windows system capability, or null. */
export function resolveWindowsSystemEntity(entity: string): WindowsSystemTarget | null {
  const e = norm(entity);
  if (!e) return null;
  // Exact/normalized match only — never fuzzy, so "files" can't drift to an app.
  return SYSTEM_ENTITIES[e] || null;
}

/** True when the wording clearly indicates a WEB target (a real domain). */
export function looksLikeDomain(entity: string): boolean {
  const e = norm(entity);
  return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/i.test(e) || /\.(com|org|net|io|dev|app|ai|co|in|gov|edu)\b/i.test(e);
}

export function __systemEntityKeys(): string[] { return Object.keys(SYSTEM_ENTITIES); }
