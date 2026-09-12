import { windowsComputerUseProvider as provider } from '../execution/WindowsComputerUseProvider';
import { eventBus } from '../events/EventBus';

/**
 * BrowserCapabilityAdapter — the browser tier of the web capability mesh.
 *
 * It REUSES the existing Windows computer-use provider (no second automation
 * framework). It can launch a browser and navigate to a URL by driving the
 * address bar (Ctrl+L, type, Enter), and observe the resulting window title.
 *
 * HONEST SCOPE: this is coarse desktop automation. Fine-grained DOM element
 * click/type and in-page verification are NOT implemented here — that is a
 * separate, higher tier (a real DOM/Playwright engine). Do not treat a
 * successful navigate as proof that an in-page element was acted upon.
 */
export class BrowserCapabilityAdapter {
  readonly id = 'browser-windows';

  async isAvailable(): Promise<boolean> {
    return provider.isAvailable();
  }

  async open(url: string, browser = 'edge'): Promise<{ ok: boolean; observation: string; verified: boolean }> {
    const target = browser || 'edge';
    eventBus.emit('tool.started', 'Browser', { url, browser: target });
    const launched = await provider.launch(target);
    if (!launched.found) {
      return { ok: false, observation: `browser "${target}" did not open`, verified: false };
    }
    // Focus the address bar and navigate.
    await provider.key('^l', target);
    await provider.type(url, target);
    await provider.key('{enter}', target);
    const obs = await provider.observe(target);
    const verified = !!obs.title; // window present; page-content verification is NOT done
    return {
      ok: verified,
      observation: `opened ${url}; window="${obs.title ?? ''}"`,
      verified,
    };
  }
}

export const browserCapability = new BrowserCapabilityAdapter();
