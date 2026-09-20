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
  voiceInput: 'LOCAL_WHISPER_READY' | 'CLOUD_ASR_READY' | 'AUTH_REQUIRED' | 'UNAVAILABLE';
  voiceOutput: 'READY'; // client Web Speech TTS; the renderer confirms at runtime
  desktop: 'READY' | 'UNAVAILABLE';
  browser: { navigation: 'READY' | 'UNAVAILABLE'; domAutomation: 'NOT_IMPLEMENTED' };
  tasks: 'READY';
  persistence: 'READY' | 'DEGRADED';
}

/** Voice-input truth: local Whisper READY wins; else a connected cloud ASR; else auth/unavailable. */
export function classifyVoiceInput(localState: string, hasCloudAsrProvider: boolean): SystemDimensions['voiceInput'] {
  if (localState === 'READY') return 'LOCAL_WHISPER_READY';
  if (hasCloudAsrProvider) return 'CLOUD_ASR_READY';
  return 'AUTH_REQUIRED';
}

export async function systemDimensions(snapshot: RuntimeSnapshot): Promise<SystemDimensions> {
  const local = await localAsrStatus();
  const isWin = platform() === 'win32';
  const hasCloudAsr = snapshot.routes.some((r) => r.enabled && r.credentialConfigured && (r.health === 'AVAILABLE' || r.health === 'AUTH_REQUIRED' || r.health === 'RATE_LIMITED' || r.health === 'DEGRADED'));
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
