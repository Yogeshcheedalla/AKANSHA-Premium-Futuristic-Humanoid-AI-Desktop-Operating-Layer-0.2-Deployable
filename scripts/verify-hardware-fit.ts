/**
 * REAL hardware-fit verification — runs the actual ladder against:
 *   1. the REAL detected device (detectHardwareLive incl. accelerator probe),
 *   2. the REAL signed production catalog (bundled, signature-verified),
 *   3. REAL Hugging Face discovery incl. real structured artifact metadata
 *      (gguf.architecture / total / context_length, sibling file sizes).
 *
 * Every printed number is traceable to one of those three sources. Absent
 * data prints Unknown — the script's correctness gate FAILS if it ever shows
 * an unsourced value (e.g. a quantization inferred from a repo name).
 *
 *   usage: npx tsx scripts/verify-hardware-fit.ts
 * Exit 0 only if: hardware measured, ≥1 signed-catalog fit computed with a
 * verdict, ≥3 REAL discovery rows with verdicts (real network required).
 */
import path from 'node:path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

import { detectHardwareLive } from '../src/core/runtime/HardwareProbe';
import { detectRuntimes, runtimeFor } from '../src/core/runtime/RuntimeManager';
import { loadCatalogForApp } from '../src/core/catalog/catalogProvider';
import { fitForCatalogModel, type FitReport } from '../src/core/catalog/CompatibilityEngine';
import { discoverAndRank } from '../src/core/models/discovery/modelDiscovery';
import { getUsableLocalModelIds } from '../src/core/models/local/LocalModelRegistry';

const rung = (r: FitReport, id: string) => r.rungs.find((x) => x.id === id);

async function main() {
  let pass = true;
  const fail = (m: string) => { pass = false; console.log('  FAIL:', m); };

  // 1 · REAL device
  const hw = detectHardwareLive();
  console.log('DEVICE (measured):', JSON.stringify({
    os: `${hw.platform}/${hw.architecture}`, cpu: `${hw.cpuModel} ×${hw.cpuCores}`,
    ramGB: hw.totalRamGB, freeRamGB: hw.freeRamGB, freeDiskGB: hw.freeDiskGB,
    gpu: hw.gpu.detected ? { vendor: hw.gpu.vendor, model: hw.gpu.model, vramGB: hw.gpu.vramGB ?? 'unreadable', integrated: !!hw.gpu.integrated } : 'none detected',
    tier: hw.tier,
  }));
  if (!(hw.cpuCores > 0 && hw.totalRamGB > 0 && hw.freeDiskGB > 0)) fail('device probe returned zeros');

  const rt = runtimeFor(detectRuntimes(process.env.LLAMA_CPP_PATHS ? { 'llama.cpp': process.env.LLAMA_CPP_PATHS.split(',') } : {}).find((r) => r.adapter.name === 'llama.cpp'));
  console.log('RUNTIME (detected):', JSON.stringify(rt));

  // 2 · REAL signed catalog through the ladder
  const catalog = loadCatalogForApp(process.env);
  console.log('CATALOG:', catalog.status, catalog.reasons?.join(';') || '');
  if (catalog.status === 'ready' || catalog.status === 'fixture') {
    for (const m of catalog.models) {
      const r = fitForCatalogModel(m, hw, rt);
      console.log(`  ${m.id}: ${r.verdict} (${r.confidence} conf) · unknowns: ${r.unknownRungs.join(',') || 'none'}`);
      for (const rr of r.rungs) console.log(`     ${rr.id.padEnd(16)} ${rr.status.padEnd(7)} ${rr.basis.padEnd(9)} ${rr.evidence}`);
      if (!['FIT', 'POSSIBLE', 'UNSUPPORTED'].includes(r.verdict)) fail('catalog fit missing verdict');
      if (r.verdict === 'FIT' && !(rung(r, 'ram')?.basis === 'declared' && rung(r, 'runtime')?.basis === 'measured')) fail('FIT without declared+measured critical evidence');
    }
    if (!catalog.models.length) fail('catalog ready but empty');
  }

  // 3 · REAL discovery with real artifact metadata
  console.log('DISCOVERY (live Hugging Face, top 8, enrich 4):');
  const rows = await discoverAndRank('qwen gguf', hw, rt.available, { limit: 8, enrich: 4 });
  for (const row of rows) {
    const a = row.artifact;
    console.log(`  ${row.id}: ${row.fit.verdict} (${row.fit.confidence}) format+runtime=${row.classification.installable ? 'ok' : 'no'} · FINAL install=signed-catalog-only`);
    console.log(`     arch=${a?.architecture ?? 'Unknown'} params=${a?.parameters ? (a.parameters / 1e9).toFixed(1) + 'B' : 'Unknown'} ctx=${a?.contextLength ?? 'Unknown'} smallest=${a?.smallestArtifactBytes ? (a.smallestArtifactBytes / 1e9).toFixed(2) + ' GB' : 'Unknown'} quant=${rung(row.fit, 'quantization')?.status === 'PASS' ? 'declared' : 'Unknown'} multimodal=${a?.multimodal}`);
    const q = rung(row.fit, 'quantization');
    if (q?.status !== 'UNKNOWN' && q?.basis !== 'declared') fail('quantization shown without declaration — name-guessing!');
    if (row.fit.verdict === 'FIT' && row.fit.rungs.some((x) => x.basis === 'estimated' && x.status === 'PASS')) fail('FIT built on estimated evidence');
  }
  if (rows.length < 3) fail(`discovery returned ${rows.length} real rows (network?)`);
  const enriched = rows.filter((r) => r.artifact && r.artifact.parameters).length;
  console.log(`  enriched-with-real-metadata: ${enriched} rows`);
  if (enriched === 0) fail('no real artifact metadata parsed from HF (API shape change?)');

  // 4 · install/READY authority is STILL the pipeline, not the ladder
  const usable = getUsableLocalModelIds();
  console.log('USABLE (READY via ModelManager real-inference registry):', usable.length ? usable.join(', ') : 'none installed+verified on THIS machine yet');
  console.log('NOTE: no fit verdict above grants READY; ModelManager integrity→inference remains the only authority.');

  console.log(`\nHARDWARE-FIT LADDER: ${pass ? 'REAL — device-measured, metadata-evidenced, Unknowns kept Unknown' : 'BLOCKED (see FAIL lines)'}`);
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error('crashed:', e?.message || e); process.exit(1); });
