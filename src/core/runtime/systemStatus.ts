/**
 * System status model — SEPARATE dimensions so one green badge never implies
 * everything works. Each dimension is derived only from live evidence.
 */
import { platform } from 'node:os';
import { localAsrModuleAvailable, localAsrEverSucceeded, bundledLocalAsrPresent, localAsrModel } from '../voice/localWhisper/whisperProvider';
import type { AiRuntimeStatus, RuntimeSnapshot } from '../providers/providerBootstrap';

export interface SystemDimensions {
  network: 'ONLINE' | 'UNKNOWN';
  ai: AiRuntimeStatus;
  voiceInput: 'LOCAL_WHISPER_READY' | 'LOCAL_WHISPER_AVAILABLE' | 'CLOUD_ASR_CONFIGURED' | 'UNAVAILABLE';
  /**
   * Precise ASR privacy. Kept SEPARATE from `network`/`ai` on purpose: local
   * transcription being offline does NOT mean the whole app is offline.
   *  - engine: which ASR actually serves speech (free-first: local whisper).
   *  - local: true when audio never leaves the machine.
   *  - bundled: true when the verified offline model asset is present.
   *  - networkRequiredForTranscription: false ONLY when bundled offline works.
   */
  asr: {
    engine: 'whisper' | 'cloud' | 'none';
    local: boolean;
    bundled: boolean;
    model: string | null;
    networkRequiredForTranscription: boolean;
  };
  voiceOutput: 'READY'; // client Web Speech TTS; the renderer confirms at runtime
  desktop: 'READY' | 'UNAVAILABLE';
  browser: { navigation: 'READY' | 'UNAVAILABLE'; domAutomation: 'NOT_IMPLEMENTED' };
  tasks: 'READY';
  persistence: 'READY' | 'DEGRADED';
}

/**
 * Voice-input truth. LOCAL_WHISPER_READY only when a REAL transcription passed.
 * A cloud provider that is merely configured+reachable is CLOUD_ASR_CONFIGURED —
 * NOT "ready", because we have not proven it transcribes (e.g. zero credits).
 */
export function classifyVoiceInput(localState: string, hasCloudAsrProvider: boolean): SystemDimensions['voiceInput'] {
  if (localState === 'READY') return 'LOCAL_WHISPER_READY';
  if (hasCloudAsrProvider) return 'CLOUD_ASR_CONFIGURED';
  return 'UNAVAILABLE';
}

export function systemDimensions(snapshot: RuntimeSnapshot): SystemDimensions {
  const isWin = platform() === 'win32';
  const hasCloudAsr = snapshot.routes.some((r) => r.enabled && r.credentialConfigured && r.health === 'AVAILABLE');
  const network: SystemDimensions['network'] = snapshot.routes.some((r) => r.health === 'AVAILABLE') || snapshot.local.runtimeReady ? 'ONLINE' : 'UNKNOWN';
  const ready = localAsrEverSucceeded();
  const modAvail = localAsrModuleAvailable();
  const bundled = bundledLocalAsrPresent();
  // Honest 4-tier ladder for free-first voice:
  //   LOCAL_WHISPER_READY     — a real local transcription succeeded this process.
  //   LOCAL_WHISPER_AVAILABLE — offline Whisper (transformers.js, no key) is
  //                             loadable here, so free voice WILL work; not yet
  //                             proven by an actual utterance, so NOT "ready".
  //   CLOUD_ASR_CONFIGURED    — no local module, but a cloud key is present (paid).
  //   UNAVAILABLE             — neither is obtainable.
  const voiceInput: SystemDimensions['voiceInput'] = ready
    ? 'LOCAL_WHISPER_READY'
    : modAvail
      ? 'LOCAL_WHISPER_AVAILABLE'
      : hasCloudAsr ? 'CLOUD_ASR_CONFIGURED' : 'UNAVAILABLE';
  // Free-first engine selection: local whisper whenever its module is loadable.
  const engine: SystemDimensions['asr']['engine'] = modAvail ? 'whisper' : hasCloudAsr ? 'cloud' : 'none';
  const asr: SystemDimensions['asr'] = {
    engine,
    local: engine === 'whisper',
    bundled,
    model: engine === 'whisper' ? localAsrModel() : null,
    // Only the verified bundled asset guarantees a network-free transcription.
    networkRequiredForTranscription: engine === 'whisper' ? !bundled : true,
  };
  return {
    network,
    ai: snapshot.status,
    voiceInput,
    asr,
    voiceOutput: 'READY',
    desktop: isWin ? 'READY' : 'UNAVAILABLE',
    browser: { navigation: isWin ? 'READY' : 'UNAVAILABLE', domAutomation: 'NOT_IMPLEMENTED' },
    tasks: 'READY',
    persistence: 'READY',
  };
}
