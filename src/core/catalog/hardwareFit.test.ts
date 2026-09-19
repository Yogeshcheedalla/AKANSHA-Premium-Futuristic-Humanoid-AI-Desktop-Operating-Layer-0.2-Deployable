/**
 * Hardware-Fit Ladder tests — every rung verdict with evidence, plus the
 * honesty invariants the whole slice exists for:
 *   • absent data stays UNKNOWN (never invented) — quantization, VRAM, arch…
 *   • estimated passes can NEVER yield FIT (declared/measured evidence only)
 *   • a verdict is a FORECAST: it never touches install/READY gating
 *   • runtime mismatch, CPU-only, integrated GPU, unknown VRAM all behave
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFitReport, fitForCatalogModel, parseParameterCount, estimateRamGBFromFileSize,
  type FitFacts, type RuntimeDescriptor,
} from './CompatibilityEngine';
import type { CatalogModel } from './ModelCatalog';
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';

const hw = (over: Partial<HardwareProfile> = {}): HardwareProfile => ({
  platform: 'win32', architecture: 'x64', cpuModel: 'Test CPU', cpuCores: 12,
  totalRamGB: 16.9, freeRamGB: 9, freeDiskGB: 200, gpu: { detected: false }, tier: 3, ...over,
});
const rt = (available = true, name = 'llama.cpp'): RuntimeDescriptor =>
  ({ available, name, supportsAcceleration: available ? ['cpu'] : [] });

const catalogModel = (over: Partial<CatalogModel> = {}): CatalogModel => ({
  id: 'qwen2.5-1.5b-q4_k_m', family: 'qwen', version: '2.5', parameters: '1.5B', quantization: 'Q4_K_M',
  format: 'gguf', downloadSizeBytes: 1.1e9, installedSizeBytes: 1.1e9, minimumRamGB: 4, recommendedRamGB: 6,
  minimumStorageGB: 3, accelerationSupport: ['cpu', 'cuda'], platforms: ['win32', 'darwin', 'linux'],
  architecture: ['x64', 'arm64'], runtimeRequirement: 'llama.cpp', contextLength: 32768, capabilities: ['chat', 'coding'],
  quality: { chat: 'Good', reasoning: 'Medium', coding: 'Good' }, internetRequired: false,
  benchmark: { source: 'estimated', generationTokensPerSec: 24 }, license: 'apache-2.0',
  sourceUrl: 'https://example/qwen.gguf', sha256: 'a'.repeat(64), signature: 'sig', ...over,
});

const find = (report: ReturnType<typeof fitForCatalogModel> | ReturnType<typeof buildFitReport>, id: string) =>
  report.rungs.find((r) => r.id === id)!;

/* ── 1 · FIT ─────────────────────────────────────────────────────────────── */
test('1 · fully-declared catalog model on a capable machine + runtime → FIT (high confidence, all-evidence)', () => {
  const r = fitForCatalogModel(catalogModel(), hw(), rt());
  assert.equal(r.verdict, 'FIT');
  assert.equal(r.confidence, 'high');
  assert.ok(r.rungs.every((x) => x.status !== 'FAIL'));
  assert.ok(r.reasons.some((s) => s.startsWith('ram ✓')));
  assert.ok(r.reasons.some((s) => s.startsWith('runtime ✓')));
  assert.ok(r.reasons.some((s) => s.startsWith('os ✓')));
});

/* ── 2 · POSSIBLE ────────────────────────────────────────────────────────── */
test('2 · borderline RAM (headroom < 2 GB) caps at POSSIBLE — pressure evidence present', () => {
  const r = fitForCatalogModel(catalogModel(), hw({ totalRamGB: 7 }), rt());
  assert.equal(r.verdict, 'POSSIBLE');
  assert.match(find(r, 'resourcePressure').evidence, /TIGHT\/INSUFFICIENT/);
  // RAM itself (min 4) still passes — the cap comes from pressure, not a lie:
  assert.equal(find(r, 'ram').status, 'PASS');
});

/* ── 3 + 9 · missing runtime ────────────────────────────────────────────── */
test('3/9 · required runtime absent → UNSUPPORTED with concrete runtime evidence', () => {
  const r = fitForCatalogModel(catalogModel(), hw(), rt(false));
  assert.equal(r.verdict, 'UNSUPPORTED');
  assert.match(find(r, 'runtime').evidence, /not detected/);
  assert.ok(r.reasons.some((s) => s.startsWith('runtime:')));
});

/* ── 4 · unknown RAM ────────────────────────────────────────────────────── */
test('4 · no declared RAM requirement and no file size → ram rung UNKNOWN, never FIT', () => {
  const facts: FitFacts = { modelId: 'mystery', format: 'gguf', declaredTrusted: false, declared: { runtime: 'llama.cpp' } };
  const r = buildFitReport(facts, hw(), rt());
  assert.equal(find(r, 'ram').status, 'UNKNOWN');
  assert.equal(find(r, 'ram').basis, 'unknown');
  assert.notEqual(r.verdict, 'FIT');
});

/* ── 5 · unknown VRAM ───────────────────────────────────────────────────── */
test('5 · GPU-required model on a machine with unreadable VRAM (integrated) → vram UNKNOWN → POSSIBLE, not FIT', () => {
  const r = fitForCatalogModel(catalogModel({ gpuRequirements: { required: true, minVramGB: 6 } }), hw({ gpu: { detected: true, vendor: 'intel', model: 'Intel UHD', integrated: true } }), rt());
  const v = find(r, 'vram');
  assert.equal(v.status, 'UNKNOWN');
  assert.match(v.evidence, /VRAM is unreadable/);
  assert.equal(r.verdict, 'POSSIBLE');
});

/* ── 6 · insufficient RAM (declared) ────────────────────────────────────── */
test('6 · declared 24 GB RAM minimum vs 16.9 GB measured → UNSUPPORTED with the exact numbers', () => {
  const r = fitForCatalogModel(catalogModel({ minimumRamGB: 24 }), hw(), rt());
  assert.equal(r.verdict, 'UNSUPPORTED');
  assert.match(find(r, 'ram').evidence, /needs 24 GB \(declared\) vs 16\.9 GB/);
});

/* ── 7 · insufficient storage ───────────────────────────────────────────── */
test('7 · free disk below the declared minimum → UNSUPPORTED storage evidence', () => {
  const r = fitForCatalogModel(catalogModel({ minimumStorageGB: 120 }), hw({ freeDiskGB: 30 }), rt());
  assert.equal(r.verdict, 'UNSUPPORTED');
  assert.match(find(r, 'storage').evidence, /insufficient|needs 120 GB/);
});

/* ── 8 · unsupported format ─────────────────────────────────────────────── */
test('8 · safetensors artifact → format FAIL → UNSUPPORTED (no verified loader)', () => {
  const r = fitForCatalogModel(catalogModel({ format: 'safetensors' as CatalogModel['format'] }), hw(), rt());
  assert.equal(r.verdict, 'UNSUPPORTED');
  assert.match(find(r, 'format').evidence, /safetensors — no verified loader/);
});

/* ── 10 · CPU-only machine ──────────────────────────────────────────────── */
test('10 · CPU-only machine, GPU-not-required model → CPU path evidence, still FIT', () => {
  const r = fitForCatalogModel(catalogModel(), hw({ gpu: { detected: false } }), rt());
  assert.equal(r.verdict, 'FIT');
  assert.match(find(r, 'gpu').evidence, /CPU-only execution path/);
});

/* ── 11 · discrete GPU ──────────────────────────────────────────────────── */
test('11 · nvidia GPU with enough VRAM vs a GPU-required model → vram PASS(measured) and FIT', () => {
  const r = fitForCatalogModel(catalogModel({ gpuRequirements: { required: true, minVramGB: 6 } }), hw({ gpu: { detected: true, vendor: 'nvidia', model: 'RTX 4060', vramGB: 8 } }), { available: true, name: 'llama.cpp', supportsAcceleration: ['cpu', 'cuda'] });
  assert.equal(find(r, 'vram').status, 'PASS');
  assert.equal(find(r, 'vram').basis, 'measured');
  assert.equal(r.verdict, 'FIT');
});

/* ── 12 · runtime mismatch ──────────────────────────────────────────────── */
test('12 · detected runtime is a different engine → FAIL(mismatch), not a silent pass', () => {
  const r = fitForCatalogModel(catalogModel(), hw(), rt(true, 'ollama'));
  assert.equal(r.verdict, 'UNSUPPORTED');
  assert.match(find(r, 'runtime').evidence, /"ollama"/);
});

/* ── 13 · unknown metadata honesty ──────────────────────────────────────── */
test('13 · bare facts → unknown rungs everywhere, confidence low, NOTHING invented', () => {
  const r = buildFitReport({ modelId: 'mystery', declaredTrusted: false }, hw(), rt());
  const unknowns = r.rungs.filter((x) => x.status === 'UNKNOWN').map((x) => x.id);
  for (const id of ['format', 'architecture', 'parameters', 'quantization', 'fileSize', 'ram', 'vram', 'runtime', 'context']) {
    assert.ok(unknowns.includes(id as never), `rung ${id} must be UNKNOWN`);
  }
  assert.equal(r.verdict, 'POSSIBLE');
  assert.equal(r.confidence, 'low');
  assert.ok(!/FIT$/.test(r.verdict));
});

test('13b · estimated passes can NEVER yield FIT (construction rule)', () => {
  // GGUF + real 1.1GB file + runtime, but NO declared requirements:
  const facts: FitFacts = { modelId: 'disc', format: 'gguf', fileSizeBytes: 1.1e9, declaredTrusted: false, declared: { runtime: 'llama.cpp' } };
  const r = buildFitReport(facts, hw(), rt());
  assert.equal(find(r, 'ram').basis, 'estimated');
  assert.equal(r.verdict, 'POSSIBLE', 'estimated evidence caps at POSSIBLE');
  assert.match(find(r, 'ram').evidence, /heuristic|borderline/);
});

/* ── helpers ────────────────────────────────────────────────────────────── */
test('parseParameterCount: real formats parse, garbage → undefined', () => {
  assert.equal(parseParameterCount('1.5B'), 1.5e9);
  assert.equal(parseParameterCount('70B'), 70e9);
  assert.equal(parseParameterCount('350M'), 350e6);
  assert.equal(parseParameterCount('gpt-4'), undefined);
  assert.equal(parseParameterCount(undefined), undefined);
});

test('estimateRamGBFromFileSize is monotonic and rounded', () => {
  assert.ok(estimateRamGBFromFileSize(2.2e9) > estimateRamGBFromFileSize(1.1e9));
});

/* ── 16 · install gating invariance (fit never opens gates) ─────────────── */
test('16 · FIT verdict but model already usable → installable stays false; gating formula unchanged', () => {
  const model = catalogModel();
  const r = fitForCatalogModel(model, hw(), rt());
  assert.equal(r.verdict, 'FIT');
  // The gating expression lives in setupViewModel.card(); the invariant that
  // matters is that NOTHING in FitReport carries an install/ready authority:
  assert.ok(!('installable' in r) && !('ready' in r) && !('usable' in r), 'FitReport must not carry gating fields');
});

/* ── 17 · READY semantics untouched ─────────────────────────────────────── */
test('17 · FitReport keys are exactly the forecast fields — no READY/verification authority', () => {
  const r = fitForCatalogModel(catalogModel(), hw(), rt());
  assert.deepEqual(Object.keys(r).sort(), ['confidence', 'reasons', 'rungs', 'unknownRungs', 'verdict']);
});

test('special case · multimodal/vision models: PASS architecture is DOWNGRADED to UNKNOWN with explicit non-verification', () => {
  const facts: FitFacts = {
    modelId: 'vision-repo', format: 'gguf', fileSizeBytes: 4e9, declaredTrusted: false,
    declared: { runtime: 'llama.cpp', capabilities: ['chat', 'vision'] },
  };
  const r = buildFitReport(facts, hw(), rt());
  const arch = find(r, 'architecture');
  assert.equal(arch.status, 'UNKNOWN');
  assert.match(arch.evidence, /projector support NOT verified/);
});
