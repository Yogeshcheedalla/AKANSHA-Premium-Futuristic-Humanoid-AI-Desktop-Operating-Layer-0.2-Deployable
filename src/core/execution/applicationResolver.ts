/**
 * ApplicationResolver — REAL Windows application discovery, behind the existing
 * allowlist security (it never invents an executable and never runs arbitrary
 * shell text; it only discovers genuine installed targets and returns a fixed
 * path + typed arguments).
 *
 * Sources (in trust order):
 *   1. curated APP_REGISTRY aliases (fast, well-known system apps)
 *   2. Windows "App Paths" registry (HKLM + HKCU) — how Windows itself resolves
 *      named apps (brave.exe, chrome.exe, …)
 *   3. Start Menu shortcuts (.lnk) for both all-users and the current user,
 *      resolved to their real target executable via the shell
 *
 * A miss returns null → the caller reports APP_NOT_FOUND honestly. It NEVER
 * substitutes a different browser/app (e.g. it will not fall back to Edge when
 * Brave was requested).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { resolveApp, expandEnv, type AppSpec } from './appRegistry';

const execFileAsync = promisify(execFile);

export interface ResolvedApplication {
  canonicalName: string;
  executable: string;
  arguments: string[];
  source: 'registry-alias' | 'app-paths' | 'start-menu' | 'known-path';
  confidence: number;
  processName: string;
  titleHint: string;
}

// Well-known browser executables — used ONLY to resolve an EXPLICITLY named
// browser; never as a silent substitute for one that is not installed.
const KNOWN_BROWSERS: Record<string, string> = {
  brave: 'brave.exe',
  'brave browser': 'brave.exe',
  chrome: 'chrome.exe',
  'google chrome': 'chrome.exe',
  edge: 'msedge.exe',
  'microsoft edge': 'msedge.exe',
  firefox: 'firefox.exe',
  'mozilla firefox': 'firefox.exe',
};

let cache: { at: number; apps: { name: string; exe: string }[] } | null = null;
const TTL_MS = 5 * 60_000;

/** Enumerate App Paths registry + Start Menu targets once (cached). */
async function discoverInstalled(): Promise<{ name: string; exe: string }[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.apps;
  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    '$out=@()',
    // App Paths registry (both hives) — name + installed exe.
    'foreach($hive in @("HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths","HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths")){',
    '  if(Test-Path $hive){ Get-ChildItem $hive | ForEach-Object {',
    '    $d=(Get-ItemProperty $_.PSPath)."(default)"; if($d){ $out += [pscustomobject]@{ name=$_.PSChildName; exe=$d } }',
    '  } }',
    '}',
    // Start Menu shortcuts resolved to their real target via the shell link API.
    '$sh=New-Object -ComObject WScript.Shell',
    'foreach($base in @($env:ProgramData,[environment]::GetFolderPath("CommonStartMenu"),$env:APPDATA)){',
    '  $root=Join-Path $base "Microsoft\\Windows\\Start Menu\\Programs"',
    '  if(Test-Path $root){ Get-ChildItem -Recurse -Filter *.lnk $root | ForEach-Object {',
    '    try { $t=$sh.CreateShortcut($_.FullName).TargetPath; if($t){ $out += [pscustomobject]@{ name=$_.BaseName; exe=$t } } } catch {}',
    '  } }',
    '}',
    '$out | Where-Object { $_.exe -match "\\.exe$" } | Sort-Object name -Unique | ConvertTo-Json -Compress',
  ].join('\n');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    );
    const raw = stdout.trim().split('\n').filter(Boolean).pop() || '[]';
    let parsed: any = [];
    try { parsed = JSON.parse(raw); } catch { parsed = []; }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const apps = arr
      .filter((a: any) => a && typeof a.name === 'string' && typeof a.exe === 'string')
      .map((a: any) => ({ name: String(a.name).toLowerCase(), exe: String(a.exe) }));
    cache = { at: Date.now(), apps };
    return apps;
  } catch {
    cache = { at: Date.now(), apps: [] };
    return [];
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\.exe$/, '').trim();
const score = (q: string, name: string) => {
  const n = norm(name);
  if (n === q) return 0.98;
  if (n.startsWith(q) || q.startsWith(n)) return 0.9;
  if (n.includes(q) || q.includes(n)) return 0.75;
  return 0;
};

/**
 * Resolve a friendly application query to a REAL installed executable.
 * Returns null when nothing credible matches (caller → APP_NOT_FOUND).
 */
export async function resolveApplication(query: string, opts: { browserOnly?: boolean } = {}): Promise<ResolvedApplication | null> {
  const q = norm(query || '');
  if (!q) return null;

  // 1. Curated registry alias — but ONLY if the exe actually exists. A stale
  //    curated path (e.g. Brave installed elsewhere) must fall through to real
  //    discovery rather than return a non-existent executable.
  const spec: AppSpec | null = resolveApp(q);
  if (spec && existsSync(expandEnv(spec.exe))) {
    const exe = expandEnv(spec.exe);
    return {
      canonicalName: spec.aliases[0], executable: exe, arguments: [],
      source: 'registry-alias', confidence: 0.99,
      processName: spec.processName || exe.split('\\').pop()!.replace(/\.exe$/i, ''),
      titleHint: spec.titleHint,
    };
  }

  // 2. Explicitly-named browser via App Paths / discovery (brave/firefox not in
  //    the curated list). NEVER substitute a different browser.
  const wantedExe = KNOWN_BROWSERS[q];
  const installed = await discoverInstalled();

  const candidates = installed
    .map((a) => ({ a, s: score(q, a.name) }))
    .filter((c) => c.s > 0)
    .sort((x, y) => y.s - x.s);

  const pick = (exe: string, source: ResolvedApplication['source'], confidence: number, name: string): ResolvedApplication => ({
    canonicalName: name, executable: exe, arguments: [], source, confidence,
    processName: exe.split('\\').pop()!.replace(/\.exe$/i, ''), titleHint: name,
  });

  if (wantedExe) {
    // A named browser: find that EXACT executable among installed apps.
    const hit = installed.find((a) => norm(a.exe).endsWith(norm(wantedExe))) || candidates.find((c) => norm(c.a.exe).endsWith(norm(wantedExe)))?.a;
    if (hit) return pick(hit.exe, 'app-paths', 0.95, q);
    return null; // requested browser not installed → APP_NOT_FOUND, never Edge
  }

  if (opts.browserOnly) return null;

  // 3. General installed-app match (e.g. "antigravity" → its real shortcut).
  if (candidates.length && candidates[0].s >= 0.75) {
    const c = candidates[0];
    return pick(c.a.exe, c.s >= 0.9 ? 'app-paths' : 'start-menu', c.s, c.a.name);
  }
  return null;
}

/** Known web destinations for "open <site>" (typed URL, never shell text). */
export const KNOWN_SITES: Record<string, string> = {
  youtube: 'https://www.youtube.com/',
  google: 'https://www.google.com/',
  gmail: 'https://mail.google.com/',
  github: 'https://github.com/',
  maps: 'https://maps.google.com/',
  'google maps': 'https://maps.google.com/',
  linkedin: 'https://www.linkedin.com/',
  twitter: 'https://twitter.com/',
  x: 'https://x.com/',
  reddit: 'https://www.reddit.com/',
  whatsapp: 'https://web.whatsapp.com/',
  'whatsapp web': 'https://web.whatsapp.com/',
  instagram: 'https://www.instagram.com/',
  chatgpt: 'https://chat.openai.com/',
  gemini: 'https://gemini.google.com/',
  stackoverflow: 'https://stackoverflow.com/',
  'stack overflow': 'https://stackoverflow.com/',
  drive: 'https://drive.google.com/',
  'google drive': 'https://drive.google.com/',
  calendar: 'https://calendar.google.com/',
  meet: 'https://meet.google.com/',
  netflix: 'https://www.netflix.com/',
};

export function resolveSite(query: string): string | null {
  const q = norm(query);
  if (KNOWN_SITES[q]) return KNOWN_SITES[q];
  // Single bare word that looks like a domain-ish token → https host.
  if (/^[a-z0-9][a-z0-9-]*$/.test(q) && q.length > 2 && !/\s/.test(q)) return `https://www.${q}.com/`;
  return null;
}

/** Validate a URL is http(s) with no shell metacharacters (defense in depth). */
export function isSafeUrl(u: string): boolean {
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') && !/[;&|<>`$\n\r]/.test(u); } catch { return false; }
}

export function __resetResolverCache() { cache = null; }
