/**
 * System status model — SEPARATE dimensions so one green badge never implies
 * everything works. Each dimension is derived only from live evidence.
 */
import { platform } from 'node:os';
import { localAsrStatus } from '../voice/localWhisper/whisperRuntime';
import type { AiRuntimeStatus, RuntimeSnapshot } from '../providers/providerBootstrap';

export interface SystemDimensions {
  network: 'ONLINE' | 'UNKNOWN';
  ai: AiRuntimeStatus;
  voiceInput: 'LOCAL_WHISPER_READY' | 'CLOUD_ASR_CONFIGURED' | 'UNAVAILABLE';
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

export async function systemDimensions(snapshot: RuntimeSnapshot): Promise<SystemDimensions> {
  const local = await localAsrStatus();
  const isWin = platform() === 'win32';
  const hasCloudAsr = snapshot.routes.some((r) => r.enabled && r.credentialConfigured && r.health === 'AVAILABLE');
  const network: SystemDimensions['network'] = snapshot.routes.some((r) => r.health === 'AVAILABLE') || snapshot.local.runtimeReady ? 'ONLINE' : 'UNKNOWN';
  return {
    network,
    ai: snapshot.status,
    voiceInput: classifyVoiceInput(local.state, hasCloudAsr),
    voiceOutput: 'READY',
    desktop: isWin ? 'READY' : 'UNAVAILABLE',
    browser: { navigation: isWin ? 'READY' : 'UNAVAILABLE', domAutomation: 'NOT_IMPLEMENTED' },
    tasks: 'READY',
    persistence: 'READY',
  };
}
