/** Real Model Discovery check against the live Hugging Face Hub (keyless), classified
 *  against this device + runtime. Runtime path supplied like the packaged backend. */
import { detectHardwareLive } from '@/core/runtime/HardwareProbe';
import { detectRuntimes, runtimeFor } from '@/core/runtime/RuntimeManager';
import { discoverAndRank } from '@/core/models/discovery/modelDiscovery';
async function main() {
  const hw = detectHardwareLive();
  const rt = runtimeFor(detectRuntimes({}).find((r) => r.adapter.name === 'llama.cpp'));
  const ranked = await discoverAndRank('qwen coding gguf', hw, rt.available, { limit: 8 });
  console.log(`runtime available: ${rt.available} | candidates: ${ranked.length}`);
  for (const m of ranked) console.log(`  ${m.classification.installable ? '[INSTALL]' : '[view]   '} ${m.id}  dl=${m.downloads} gguf=${m.isGguf} :: ${m.classification.reason}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
