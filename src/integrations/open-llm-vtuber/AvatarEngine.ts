import { eventBus } from '../../core/events/EventBus';

export type AvatarState =
  | 'IDLE'
  | 'LISTENING'
  | 'UNDERSTANDING'
  | 'THINKING'
  | 'PLANNING'
  | 'EXECUTING'
  | 'WAITING'
  | 'VERIFYING'
  | 'LEARNING'
  | 'SUCCESS'
  | 'WARNING'
  | 'ERROR'
  | 'RECOVERING'
  | 'OFFLINE';

export type AvatarEmotion = 'neutral' | 'happy' | 'curious' | 'focused' | 'concerned' | 'satisfied' | 'surprised';

export type Viseme = 'sil' | 'aa' | 'ee' | 'oh' | 'oo' | 'ih' | 'mm' | 'f';

export interface AvatarRuntime {
  id: string;
  kind: 'gltf-3d' | 'live2d' | 'webgl' | 'none';
  loadModel(uri: string): Promise<boolean>;
  unloadModel(): void;
  setState(state: AvatarState): void;
  setEmotion(emotion: AvatarEmotion): void;
  setLipSync(viseme: Viseme, intensity: number): void;
  setGaze(x: number, y: number): void;
  setGesture(gesture: string): void;
  playAnimation(name: string, loop?: boolean): void;
  stopAnimation(name: string): void;
  setAudioLevel(level: number): void;
  health(): { ready: boolean; modelLoaded: boolean };
}

/**
 * Renderer-neutral avatar abstraction.
 *
 * The avatar state is DERIVED from authoritative mission/speech state —
 * it never invents its own state. It consumes speech events (from the single
 * SpeechOutputManager) to drive lip-sync and facial animation.
 */
export class AvatarEngine {
  private runtime: AvatarRuntime | null = null;
  private currentState: AvatarState = 'IDLE';
  private currentEmotion: AvatarEmotion = 'neutral';
  private modelLoaded = false;

  attachRuntime(runtime: AvatarRuntime) {
    this.runtime = runtime;
  }

  detachRuntime() {
    this.runtime?.unloadModel();
    this.runtime = null;
    this.modelLoaded = false;
  }

  async loadModel(uri: string): Promise<boolean> {
    if (!this.runtime) return false;
    const ok = await this.runtime.loadModel(uri);
    this.modelLoaded = ok;
    return ok;
  }

  unload() {
    this.runtime?.unloadModel();
    this.modelLoaded = false;
  }

  /**
   * Set state from authoritative mission state (NOT invented by UI).
   */
  setState(state: AvatarState) {
    if (this.currentState === state) return;
    const prev = this.currentState;
    this.currentState = state;
    this.runtime?.setState(state);

    // Derive emotion from state
    const emotionMap: Partial<Record<AvatarState, AvatarEmotion>> = {
      SUCCESS: 'satisfied',
      ERROR: 'concerned',
      WARNING: 'concerned',
      THINKING: 'focused',
      PLANNING: 'focused',
      VERIFYING: 'focused',
      EXECUTING: 'focused',
      LEARNING: 'curious',
      UNDERSTANDING: 'curious',
      LISTENING: 'curious',
      RECOVERING: 'concerned',
    };
    const emotion = emotionMap[state] || 'neutral';
    this.setEmotion(emotion);

    eventBus.emit('avatar.state_changed', 'AvatarEngine', { from: prev, to: state, emotion });
  }

  setEmotion(emotion: AvatarEmotion) {
    this.currentEmotion = emotion;
    this.runtime?.setEmotion(emotion);
  }

  /**
   * Drive lip-sync from speech. Consumes audio events; does NOT create TTS.
   */
  setLipSync(viseme: Viseme, intensity: number) {
    this.runtime?.setLipSync(viseme, intensity);
  }

  setAudioLevel(level: number) {
    this.runtime?.setAudioLevel(level);
  }

  setGaze(x: number, y: number) {
    this.runtime?.setGaze(x, y);
  }

  setGesture(gesture: string) {
    this.runtime?.setGesture(gesture);
  }

  playAnimation(name: string, loop = false) {
    this.runtime?.playAnimation(name, loop);
  }

  stopAnimation(name: string) {
    this.runtime?.stopAnimation(name);
  }

  getState(): AvatarState {
    return this.currentState;
  }

  health() {
    return {
      runtimeAttached: !!this.runtime,
      modelLoaded: this.modelLoaded,
      state: this.currentState,
      emotion: this.currentEmotion,
    };
  }
}

export const avatarEngine = new AvatarEngine();
