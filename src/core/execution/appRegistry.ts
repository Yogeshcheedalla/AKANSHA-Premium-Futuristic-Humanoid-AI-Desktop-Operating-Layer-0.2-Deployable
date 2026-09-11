/**
 * Application registry — maps friendly names to real Windows executables and a
 * window-title hint used for observation/verification. Only whitelisted entries
 * can be launched by the low-risk execution path; anything not here requires an
 * explicit, authorized absolute path (and is treated as higher risk).
 */

export interface AppSpec {
  /** Friendly names / aliases the user might say. */
  aliases: string[];
  /** Executable to launch (resolved at runtime; %WINDIR% etc. expanded). */
  exe: string;
  /** Regex matched against top-level window titles to find/verify the app. */
  titleHint: string;
  /** Process name used for a quick "is it running" check. */
  processName?: string;
  /**
   * 'win32' = direct exe with a normal HWND; 'store' = app-execution alias that
   * spawns a separate windowed process (e.g. Windows 11 Notepad) so we must
   * match by title, not by the launched PID.
   */
  launch: 'win32' | 'store';
}

export const APP_REGISTRY: AppSpec[] = [
  { aliases: ['notepad', 'text editor'], exe: '%WINDIR%\\System32\\notepad.exe', titleHint: 'notepad', processName: 'notepad', launch: 'store' },
  { aliases: ['paint', 'mspaint'], exe: '%WINDIR%\\System32\\mspaint.exe', titleHint: 'paint', processName: 'mspaint', launch: 'win32' },
  { aliases: ['character map', 'charmap'], exe: '%WINDIR%\\System32\\charmap.exe', titleHint: 'character map', processName: 'charmap', launch: 'win32' },
  { aliases: ['command prompt', 'cmd', 'terminal'], exe: '%WINDIR%\\System32\\cmd.exe', titleHint: 'command prompt', processName: 'cmd', launch: 'win32' },
  { aliases: ['calculator', 'calc'], exe: '%WINDIR%\\System32\\win32calc.exe', titleHint: 'calculator', processName: 'win32calc', launch: 'win32' },
  { aliases: ['wordpad'], exe: '%WINDIR%\\System32\\wordpad.exe', titleHint: 'wordpad', processName: 'wordpad', launch: 'win32' },
  { aliases: ['explorer', 'file explorer', 'this pc'], exe: '%WINDIR%\\explorer.exe', titleHint: 'explorer', processName: 'explorer', launch: 'win32' },
];

const norm = (s: string) => s.toLowerCase().trim();

export function resolveApp(query: string): AppSpec | null {
  const q = norm(query);
  if (!q) return null;
  for (const spec of APP_REGISTRY) {
    if (spec.aliases.some((a) => q === a || q.includes(a) || a.includes(q))) return spec;
  }
  return null;
}

export function expandEnv(p: string): string {
  return p
    .replace(/%WINDIR%/gi, process.env.SystemRoot || process.env.windir || 'C:\\Windows')
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || '')
    .replace(/%APPDATA%/gi, process.env.APPDATA || '');
}
