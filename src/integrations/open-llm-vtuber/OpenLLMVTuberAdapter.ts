import { avatarEngine, type AvatarState, type AvatarEmotion, type Viseme, type AvatarRuntime } from './AvatarEngine';
import { eventBus } from '../../core/events/EventBus';

export type IntegrationHealth = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'STARTING' | 'STOPPED' | 'AUTH_REQUIRED' | 'INCOMPATIBLE';

export interface VTuberCapabilities {
  live2dAvatar: boolean;
  desktopCompanion: boolean;
  visualPerception: boolean;
  cameraAwareness: boolean;
  voiceInteraction: boolean;
  voiceInterruption: boolean;
  expressionMapping: boolean;
  proactiveSpeaking: boolean;
  modularASR: boolean;
  modularTTS: boolean;
  lipSync: boolean;
}

export interface VTuberHealth {
  state: IntegrationHealth;
  version?: string;
  latencyMs: number;
  lastFailure?: string;
  capabilities: VTuberCapabilities;
}

/**
 * Open-LLM-VTuber integration — HUMANOID INTERACTION / AVATAR / VOICE-PRESENCE layer.
 *
 * This adapter exposes VTuber capabilities to Akansha, but it does NOT own
 * orchestration, and it does NOT create a second TTS pipeline. It adapts
 * VTuber's model-provider abstraction to Akansha's ModelRouter (which routes
 * to Experiential Labs — no Ollama / llama.cpp).
 */
export class OpenLLMVTuberAdapter {
  private health: VTuberHealth = {
    state: 'STOPPED',
    latencyMs: 0,
    capabilities: {
      live2dAvatar: false,
      desktopCompanion: true,
      visualPerception: false,
      cameraAwareness: false,
      voiceInteraction: true,
      voiceInterruption: true,
      expressionMapping: true,
      proactiveSpeaking: true,
      modularASR: true,
      modularTTS: true,
      lipSync: true,
    },
  };

  /**
   * Adapt a VTuber-style model provider to Akansha's ModelRouter.
   * This is intentionally a NO-OP passthrough that redirects all model
   * intelligence to Akansha's ModelRouter (Experiential Labs), enforcing the
   * "NO local LLM fallback" policy.
   */
  bindModelProvider(router: { routeTask: (taskType: string, capabilities?: string[]) => Promise<any> }) {
    // The VTuber layer must route through Akansha's ModelRouter, never directly
    // to Ollama/llama.cpp. We expose a provider-shaped object that delegates.
    return {
      id: 'open-llm-vtuber-adapted',
      generate: async () => {
        throw new Error('Open-LLM-VTuber model provider is adapted OUT. Use Akansha ModelRouter (Experiential Labs).');
      },
      stream: async () => {
        throw new Error('Open-LLM-VTuber model provider is adapted OUT. Use Akansha ModelRouter (Experiential Labs).');
      },
      route: router.routeTask.bind(router),
    };
  }

  async initialize(): Promise<VTuberHealth> {
    this.health.state = 'STARTING';
    eventBus.emit('integration.health_changed', 'OpenLLMVTuber', { state: 'STARTING' });

    try {
      // Simulate readiness of the VTuber presence layer (no local LLM loading)
      this.health.state = 'AVAILABLE';
      this.health.latencyMs = 0;
      this.health.version = 'adapted-for-akansha';
      eventBus.emit('integration.health_changed', 'OpenLLMVTuber', { state: 'AVAILABLE' });
      return this.health;
    } catch (e: any) {
      this.health.state = 'UNAVAILABLE';
      this.health.lastFailure = e?.message;
      eventBus.emit('integration.health_changed', 'OpenLLMVTuber', { state: 'UNAVAILABLE', error: e?.message });
      return this.health;
    }
  }

  getHealth(): VTuberHealth {
    return { ...this.health };
  }

  /**
   * Set avatar state from authoritative Akansha mission state.
   */
  setAvatarState(state: AvatarState) {
    avatarEngine.setState(state);
  }

  setEmotion(emotion: AvatarEmotion) {
    avatarEngine.setEmotion(emotion);
  }

  /**
   * Lip-sync driven by the SINGLE SpeechOutputManager audio stream.
   */
  setLipSync(viseme: Viseme, intensity: number) {
    avatarEngine.setLipSync(viseme, intensity);
  }

  setAudioLevel(level: number) {
    avatarEngine.setAudioLevel(level);
  }

  /**
   * Speech interruption — stops current speech so a new request takes priority.
   */
  interruptSpeech() {
    eventBus.emit('speech.interrupted', 'OpenLLMVTuber', {});
  }

  /**
   * Attach a concrete runtime (glTF-3D or Live2D) to the renderer-neutral engine.
   */
  attachRuntime(runtime: AvatarRuntime) {
    avatarEngine.attachRuntime(runtime);
  }

  getCapabilities(): VTuberCapabilities {
    return { ...this.health.capabilities };
  }
}

export const openLLMVTuber = new OpenLLMVTuberAdapter();
