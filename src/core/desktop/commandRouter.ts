/**
 * Deterministic command router — obvious OS/browser commands map directly to a
 * typed Action Fabric request WITHOUT an LLM round-trip. Ambiguous text returns
 * null so the existing orchestrator/planner (with a model) can handle it.
 *
 * Handles:
 *   "open youtube"                 → browser.navigate {url}
 *   "open youtube in brave"        → browser.navigate {url, browser:'brave'}   (never Edge)
 *   "open notepad"                 → desktop.app.launch {application:'notepad'}
 *   "open antigravity"             → desktop.app.launchResolved {…discovered exe…}
 *   "close notepad" / "focus brave"→ desktop.app.close / desktop.window.focus
 *
 * It NEVER turns arbitrary text into a shell command; every payload is a
 * validated name/URL/exe produced by the resolvers.
 */
import { resolveApp } from '@/core/execution/appRegistry';
import { resolveApplication, resolveSite, KNOWN_SITES } from '@/core/execution/applicationResolver';
import { resolveWindowsSystemEntity, looksLikeDomain } from '@/core/execution/windowsSystemEntities';

export interface RoutedCommand {
  actionId: 'desktop.app.launch' | 'desktop.app.close' | 'desktop.window.focus' | 'browser.navigate' | 'desktop.app.launchResolved';
  payload: Record<string, unknown>;
  label: string;
}

const BROWSER_WORDS = new Set(['brave', 'chrome', 'google chrome', 'edge', 'microsoft edge', 'firefox', 'mozilla firefox', 'browser']);
const OPEN = /^\s*(?:please\s+|can you\s+|could you\s+)?(?:open|launch|start|run|go to|navigate to|bring up|fire up|take me to|show me|pull up)\s+(.+?)\s*[.!?,]*$/i;
const CLOSE = /^\s*(?:please\s+|can you\s+)?(?:close|quit|exit|kill|terminate|stop|shut)\s+(.+?)\s*[.!?,]*$/i;
const FOCUS = /^\s*(?:please\s+|can you\s+)?(?:focus|activate|raise|foreground|switch to)\s+(.+?)\s*[.!?,]*$/i;
// "youtube in brave", "youtube in the brave browser", "gmail in google chrome"
const IN_BROWSER = /^(.+?)\s+(?:in|using|with|on)\s+(?:the\s+)?(brave|chrome|google chrome|edge|microsoft edge|firefox|mozilla firefox|browser)(?:\s+browser)?\s*$/i;
// File search variations: "open files, search Yogesh", "find Yogesh in my files", "search my files for Yogesh"
const FILE_SEARCH = /^\s*(?:please\s+|can you\s+|could you\s+)?(?:open\s+(?:the\s+)?files,?\s+search\s+(?:for\s+)?(.+?)(?:,?\s+and\s+open\s+it\s+in\s+(?:the\s+)?(.+?)(?:\s+browser)?)?|find\s+(.+?)\s+in\s+(?:my\s+)?files|search\s+(?:my\s+)?files\s+for\s+(.+?)|open\s+(?:the\s+)?(.+?)\s+file\s+in\s+(.+?)(?:\s+browser)?)\s*[.!?,]*$/i;

const clean = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export async function routeCommand(text: string): Promise<RoutedCommand | null> {
  const t = (text || '').trim();
  if (!t || t.length > 120 || /[;&|<>`$\n\r]/.test(t)) return null;

  let verb: 'open' | 'close' | 'focus' | null = null;
  let rest = '';
  let m: RegExpMatchArray | null;

  // 0. Dedicated File Search Extraction
  if ((m = t.match(FILE_SEARCH))) {
    const query = clean(m[1] || m[3] || m[4] || m[5]);
    const browser = clean(m[2] || m[6] || '');
    return {
      actionId: 'desktop.files.searchAndOpen' as any,
      payload: { query, browser: browser || undefined },
      label: `File search: ${query}${browser ? ` -> ${browser}` : ''}`
    };
  }

  if ((m = t.match(OPEN))) { verb = 'open'; rest = clean(m[1]); }
  else if ((m = t.match(CLOSE))) { verb = 'close'; rest = clean(m[1]); }
  else if ((m = t.match(FOCUS))) { verb = 'focus'; rest = clean(m[1]); }
  else return null;
  if (!rest) return null;

  // close/focus operate on an app/browser by name — resolve to a canonical app.
  if (verb === 'close' || verb === 'focus') {
    const app = resolveApp(rest);
    if (app) return { actionId: verb === 'close' ? 'desktop.app.close' : 'desktop.window.focus', payload: { application: app.aliases[0] }, label: app.aliases[0] };
    const r = await resolveApplication(rest);
    if (r) return { actionId: verb === 'close' ? 'desktop.app.close' : 'desktop.window.focus', payload: { application: r.canonicalName }, label: r.canonicalName };
    return null;
  }

  // open: split an explicit "in <browser>" so the choice is TYPED, never guessed.
  let browser = '';
  let target = rest;
  const bm = rest.match(IN_BROWSER);
  if (bm) { target = clean(bm[1]); browser = clean(bm[2]); }

  // A named browser with no site → just launch the browser app.
  if (BROWSER_WORDS.has(target) && !browser) { browser = target; target = ''; }
  if (browser && !target) {
    const app = resolveApp(browser);
    if (app) return { actionId: 'desktop.app.launch', payload: { application: app.aliases[0] }, label: app.aliases[0] };
    const r = await resolveApplication(browser, { browserOnly: true });
    if (r) return { actionId: 'desktop.app.launchResolved', payload: { executable: r.executable, processName: r.processName, titleHint: r.titleHint, label: r.canonicalName }, label: r.canonicalName };
    return { actionId: 'desktop.app.launch', payload: { application: browser }, label: browser }; // let fabric report APP_NOT_FOUND honestly
  }

  // 0. A WINDOWS SYSTEM ENTITY resolves first — before apps and before any web
  //    interpretation. This is what stops "open files"→VLC and "open settings"→
  //    settings.com. Only native, verifiable capabilities are in this registry.
  const sys = resolveWindowsSystemEntity(target);
  if (sys) {
    return { actionId: 'desktop.app.launchResolved', payload: { executable: sys.executable, args: sys.args, processName: sys.processName, titleHint: sys.titleHint, label: sys.label }, label: sys.label };
  }

  // 1. A curated/known APPLICATION wins (so "open notepad" is never read as a site).
  const app = resolveApp(target);
  if (app) return { actionId: 'desktop.app.launch', payload: { application: app.aliases[0] }, label: app.aliases[0] };

  // 2. A KNOWN site (exact map) → browser.navigate.
  if (KNOWN_SITES[target]) {
    return { actionId: 'browser.navigate', payload: { url: KNOWN_SITES[target], browser: browser || undefined }, label: `${target}${browser ? ` in ${browser}` : ''}` };
  }

  // 3. Real installed-app discovery (e.g. "antigravity").
  const r = await resolveApplication(target);
  if (r) return { actionId: 'desktop.app.launchResolved', payload: { executable: r.executable, processName: r.processName, titleHint: r.titleHint, label: r.canonicalName }, label: r.canonicalName };

  // 4. An EXPLICIT web target only — a real domain (settings.com) or a known site.
  //    NEVER fabricate word.com for a bare/generic word.
  if (looksLikeDomain(target)) {
    const url = resolveSite(target) || `https://${target.replace(/^https?:\/\//, '')}`;
    return { actionId: 'browser.navigate', payload: { url, browser: browser || undefined }, label: `${target}${browser ? ` in ${browser}` : ''}` };
  }

  // Unresolved → let the orchestrator/model handle it or report not-found. Do NOT
  // guess a website or a vague application.
  return null;
}
