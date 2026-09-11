import { eventBus } from '../../core/events/EventBus';

export type BrowserCapabilityLevel =
  | 'DOM_PAGE_AGENT' // Level 1 — Page Agent (DOM/text-based)
  | 'BROWSER_EXTENSION' // Level 2 — extension / multi-page
  | 'BROWSER_AUTOMATION' // Level 3 — full automation engine
  | 'ACCESSIBILITY_TREE' // Level 4 — accessibility API
  | 'VISION_SCREENSHOT' // Level 5 — vision / screenshot understanding
  | 'COMPUTER_USE' // Level 6 — desktop UI automation
  | 'MANUAL_CONFIRMATION'; // Level 7 — ask the user

export interface EscalationResult {
  level: BrowserCapabilityLevel;
  action: string;
  observation: string;
  verified: boolean;
  failureCause?: string;
}

export interface EscalationCause {
  cause: string;
  nextLevel: BrowserCapabilityLevel;
}

/**
 * Browser Capability Escalation ladder.
 *
 * For every web task, start at the most appropriate level and escalate
 * automatically when a capability fails (canvas, iframe, CAPTCHA, OS dialog, etc).
 * Never repeatedly retry the same failing action.
 */
export class BrowserEscalation {
  private levelOrder: BrowserCapabilityLevel[] = [
    'DOM_PAGE_AGENT',
    'BROWSER_EXTENSION',
    'BROWSER_AUTOMATION',
    'ACCESSIBILITY_TREE',
    'VISION_SCREENSHOT',
    'COMPUTER_USE',
    'MANUAL_CONFIRMATION',
  ];

  private causeMap: Record<string, BrowserCapabilityLevel> = {
    canvas: 'VISION_SCREENSHOT',
    'custom rendered control': 'VISION_SCREENSHOT',
    'inaccessible iframe': 'BROWSER_EXTENSION',
    'visual-only state': 'VISION_SCREENSHOT',
    'login challenge': 'BROWSER_AUTOMATION',
    captcha: 'MANUAL_CONFIRMATION',
    'os dialog': 'COMPUTER_USE',
    'shadow dom': 'BROWSER_AUTOMATION',
  };

  classifyCause(failure: string): BrowserCapabilityLevel {
    const f = failure.toLowerCase();
    for (const [key, level] of Object.entries(this.causeMap)) {
      if (f.includes(key)) return level;
    }
    // Default: step up one level
    return this.nextLevel(this.detectCurrentLevel(failure));
  }

  detectCurrentLevel(context: string): BrowserCapabilityLevel {
    const c = context.toLowerCase();
    if (c.includes('vision')) return 'VISION_SCREENSHOT';
    if (c.includes('accessibility')) return 'ACCESSIBILITY_TREE';
    if (c.includes('extension')) return 'BROWSER_EXTENSION';
    if (c.includes('computer')) return 'COMPUTER_USE';
    return 'DOM_PAGE_AGENT';
  }

  nextLevel(current: BrowserCapabilityLevel): BrowserCapabilityLevel {
    const idx = this.levelOrder.indexOf(current);
    if (idx < 0 || idx >= this.levelOrder.length - 1) return 'MANUAL_CONFIRMATION';
    return this.levelOrder[idx + 1];
  }

  /**
   * Escalate after a capability failure. Emits a recovery/replan event and
   * records the cause classification for cross-mission learning.
   */
  escalate(current: BrowserCapabilityLevel, failure: string): EscalationCause {
    const nextLevel = this.classifyCause(failure);
    eventBus.emit('recovery.started', 'BrowserEscalation', { current, failure, nextLevel });
    eventBus.emit('replan.started', 'BrowserEscalation', { current, failure, nextLevel });
    return { cause: failure, nextLevel };
  }

  /**
   * Decide the best initial level for a web task description.
   */
  initialLevel(task: string): BrowserCapabilityLevel {
    const t = task.toLowerCase();
    if (t.includes('form') || t.includes('fill') || t.includes('type') || t.includes('click') || t.includes('button')) {
      return 'DOM_PAGE_AGENT'; // forms/buttons = Page Agent's strength
    }
    if (t.includes('visual') || t.includes('canvas') || t.includes('image')) {
      return 'VISION_SCREENSHOT';
    }
    if (t.includes('desktop') || t.includes('os dialog')) {
      return 'COMPUTER_USE';
    }
    return 'DOM_PAGE_AGENT';
  }

  recordOutcome(level: BrowserCapabilityLevel, verified: boolean, latencyMs: number) {
    eventBus.emit('tool.completed', 'BrowserEscalation', { level, verified, latencyMs });
  }
}

export const browserEscalation = new BrowserEscalation();
