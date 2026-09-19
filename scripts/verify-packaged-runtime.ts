/**
 * Packaged-runtime discovery check — simulates the installed app (NO LLAMA_CPP_PATHS)
 * and confirms the app finds a bundled/provisioned runtime via defaultLlamaCandidates
 * (cwd/runtime/llama here; resourcesPath/runtime/llama in the packaged app), and that
 * a persisted usable model + runtime make offline READY achievable.
 */
import { detectRuntimes, runtimeFor } from '@/core/runtime/RuntimeManager';
import { getUsableLocalModelIds } from '@/core/models/local/LocalModelRegistry';
import { getSetupViewModel } from '@/core/aiSetup/setupViewModel';

delete process.env.LLAMA_CPP_PATHS; // packaged app has no env override
const rt = runtimeFor(detectRuntimes({}).find((r) => r.adapter.name === 'llama.cpp'));
const usable = getUsableLocalModelIds();
console.log('runtime discovered via default candidates (no LLAMA_CPP_PATHS):', rt.available, rt.name);
console.log('persisted usable models:', JSON.stringify(usable));
const vm = getSetupViewModel();
console.log('setup aiMode:', vm.aiMode.recommended, 'offlineReady:', vm.aiMode.offlineReady, '| runtime.available:', vm.runtime.available);
const ok = rt.available && usable.length > 0 && vm.runtime.available && vm.aiMode.offlineReady;
console.log(`\nPackaged-app Model Center READY path: ${ok ? 'VERIFIED (runtime discovered + model persisted + offline ready)' : 'NOT VERIFIED'}`);
process.exit(ok ? 0 : 1);
