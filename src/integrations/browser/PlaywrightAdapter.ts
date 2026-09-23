import { chromium, type Browser, type Page } from 'playwright';

export interface PlaywrightObservation {
  success: boolean;
  url: string;
  title: string;
  error?: string;
}

export class PlaywrightAdapter {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async initialize() {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: false });
      this.page = await this.browser.newPage();
    }
  }

  async navigate(url: string): Promise<PlaywrightObservation> {
    await this.initialize();
    try {
      if (!this.page) throw new Error('Page not initialized');
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      return {
        success: true,
        url: this.page.url(),
        title: await this.page.title(),
      };
    } catch (e: any) {
      return {
        success: false,
        url: this.page?.url() || url,
        title: '',
        error: e.message,
      };
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

export const playwrightAdapter = new PlaywrightAdapter();
