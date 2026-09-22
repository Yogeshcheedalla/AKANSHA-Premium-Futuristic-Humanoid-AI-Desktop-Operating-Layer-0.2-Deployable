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
  { aliases: ['edge', 'microsoft edge', 'browser'], exe: '%PROGRAMFILESX86%\\Microsoft\\Edge\\Application\\msedge.exe', titleHint: 'Microsoft Edge', processName: 'msedge', launch: 'win32' },
  { aliases: ['chrome', 'google chrome'], exe: '%PROGRAMFILES%\\Google\\Chrome\\Application\\chrome.exe', titleHint: 'Google Chrome', processName: 'chrome', launch: 'win32' },
  { aliases: ['brave', 'brave browser'], exe: '%PROGRAMFILESX86%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', titleHint: 'Brave', processName: 'brave', launch: 'win32' },
  { aliases: ['firefox', 'mozilla firefox'], exe: '%PROGRAMFILES%\\Mozilla Firefox\\firefox.exe', titleHint: 'Firefox', processName: 'firefox', launch: 'win32' },
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Generic words that must NOT let a longer, more specific phrase resolve to a
// particular app (e.g. the word "browser" inside "the brave browser" must not
// hijack the match to Edge). They only apply when they ARE the whole query.
const GENERIC = new Set(['browser', 'app', 'application', 'program']);

/** True when `alias` occurs in `q` as a whole word/phrase (bounded by non-letters). */
function hasPhrase(q: string, alias: string): boolean {
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, 'i').test(q);
}

export function resolveApp(query: string): AppSpec | null {
  const q = norm(query);
  if (!q) return null;
  const words = q.split(' ');

  // 1) An exact alias match always wins.
  for (const spec of APP_REGISTRY) {
    if (spec.aliases.some((a) => q === a)) return spec;
  }

  // 2) Otherwise the MOST SPECIFIC whole-word/phrase alias wins (longest alias).
  //    A generic word ("browser") never matches inside a multi-word phrase, so
  //    "youtube in the brave browser" cannot resolve to Edge.
  let best: { spec: AppSpec; len: number } | null = null;
  for (const spec of APP_REGISTRY) {
    for (const a of spec.aliases) {
      if (GENERIC.has(a) && words.length > 1) continue;
      if (hasPhrase(q, a) && (!best || a.length > best.len)) best = { spec, len: a.length };
    }
  }
  return best ? best.spec : null;
}

export function expandEnv(p: string): string {
  return p
    .replace(/%WINDIR%/gi, process.env.SystemRoot || process.env.windir || 'C:\\Windows')
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || '')
    .replace(/%APPDATA%/gi, process.env.APPDATA || '')
    .replace(/%PROGRAMFILESX86%/gi, process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)')
    .replace(/%PROGRAMFILES%/gi, process.env.ProgramFiles || 'C:\\Program Files');
}
