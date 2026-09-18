/**
 * Pure keyboard-voice shortcut handling for Akansha. Extracted so it is unit-testable
 * without a DOM, and so the SAME logic can back both the in-app (renderer) listeners and
 * a future Electron global-shortcut adapter. It only DECIDES which existing voice action
 * to invoke — it never touches the microphone itself (the single AudioEngine authority does).
 */
export interface VoiceShortcutActions {
  toggle(): void | Promise<void>;
  startPushToTalk(): void | Promise<void>;
  stopPushToTalk(): void;
  stop(): void;
}

/** Minimal shape of a KeyboardEvent we depend on (testable without DOM). */
export interface KeySignal {
  code?: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
}

const isMod = (e: KeySignal) => !!e.ctrlKey || !!e.metaKey;
const isSpace = (e: KeySignal) => e.code === 'Space' || e.key === ' ';
const isEscape = (e: KeySignal) => e.code === 'Escape' || e.key === 'Escape';

/** Ctrl/Cmd+Space → toggle; Ctrl/Cmd+Shift+Space → push-to-talk start; Escape → stop.
 *  Auto-repeat is ignored so a held key cannot fire duplicate activations. */
export function handleVoiceKeydown(e: KeySignal, a: VoiceShortcutActions): void {
  if (e.repeat) return;
  if (isEscape(e)) return a.stop();
  if (isSpace(e) && isMod(e) && e.shiftKey) return void a.startPushToTalk();
  if (isSpace(e) && isMod(e) && !e.shiftKey) return void a.toggle();
}

/** Releasing Ctrl/Cmd+Shift+Space ends push-to-talk (release-to-stop). */
export function handleVoiceKeyup(e: KeySignal, a: VoiceShortcutActions): void {
  if (isSpace(e) && isMod(e) && e.shiftKey) a.stopPushToTalk();
}
