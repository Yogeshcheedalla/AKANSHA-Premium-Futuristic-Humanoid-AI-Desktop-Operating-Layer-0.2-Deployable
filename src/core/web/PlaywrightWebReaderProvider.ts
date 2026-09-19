import type { WebDocument, WebReaderProvider } from './types';
import { extractDocument } from './HttpWebReaderProvider';

/**
 * Loaded through a non-analyzable dynamic import so `playwright` stays an
 * OPTIONAL dependency: the bundler never resolves it and its absence is a
 * normal, honest state (isAvailable:false), not a build error.
 */
const optionalImport: (specifier: string) => Promise<any> = new Function('s', 'return import(s)') as any;

/**
 * PlaywrightWebReaderProvider — the BROWSER tier of page retrieval, deliberately
 * expensive and gated:
 *
 *  • used by WebCapability.read ONLY after plain HTTP retrieval failed for a URL
 *    (i.e. the page likely needs JavaScript), never for every result;
 *  • isAvailable() is true only when the `playwright` package is genuinely
 *    installed and not disabled via AKANSHA_BROWSER_RETRIEVAL=0 — it never
 *    claims a browser ran when none is present;
 *  • rendered HTML goes through the SAME typed extraction pipeline, and scripts
 *    are stripped: page content remains untrusted data, never executed code.
 */
export class PlaywrightWebReaderProvider implements WebReaderProvider {
  readonly id = 'playwright-reader';

  async isAvailable(): Promise<boolean> {
    if ((process.env.AKANSHA_BROWSER_RETRIEVAL || '').trim() === '0') return false;
    try {
      await optionalImport('playwright');
      return true;
    } catch {
      return false; // not installed → honest absence, no fake browser tier.
    }
  }

  async read(url: string): Promise<WebDocument> {
    const retrievedAt = Date.now();
    const base: WebDocument = { url, title: '', text: '', headings: [], links: [], metadata: {}, retrievedAt, ok: false };
    if (!/^https?:\/\//i.test(url)) return { ...base, error: 'only http(s) URLs are supported' };
    let browser: any = null;
    try {
      const { chromium } = await optionalImport('playwright');
      browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(url, { timeout: 25000, waitUntil: 'domcontentloaded' });
      const html = String(await page.content());
      const doc = extractDocument(html, url);
      await browser.close();
      if (!doc.text || doc.text.length < 40) return { ...base, error: 'rendered page had no extractable content' };
      return { ...doc, ok: true, url, via: 'playwright', retrievedAt };
    } catch (e: any) {
      try { await browser?.close?.(); } catch { /* best effort */ }
      return { ...base, error: 'browser-fallback-failed:' + String(e?.message || e).slice(0, 80) };
    }
  }
}

export const playwrightWebReader = new PlaywrightWebReaderProvider();
