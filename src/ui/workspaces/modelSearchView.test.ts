import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSearchCards } from './modelSearchView';
import type { RankedDiscoveredModel } from '@/core/models/discovery/modelDiscovery';
import type { FitReport } from '@/core/catalog/CompatibilityEngine';

const fitStub: FitReport = { verdict: 'POSSIBLE', confidence: 'moderate', reasons: ['ram: no declared requirement'], unknownRungs: ['quantization'], rungs: [] };

const mk = (id: string, installable: boolean, over: Partial<RankedDiscoveredModel> = {}): RankedDiscoveredModel => ({
  id, author: id.split('/')[0], downloads: 100, likes: 5, tags: ['gguf'], isGguf: true,
  repoUrl: `https://huggingface.co/${id}`, source: 'huggingface',
  classification: { installable, formatSupported: true, runtimeSupported: installable, reason: installable ? 'GGUF + runtime' : 'no runtime' },
  artifact: null, fit: fitStub,
  ...over,
});

test('discovered model NOT in signed catalog → INSTALL gated off with honest reason', () => {
  const [card] = toSearchCards([mk('Qwen/Some-GGUF', true)], ['qwen2.5-1.5b-instruct-q4_k_m']);
  assert.equal(card.installable, false);
  assert.match(card.installReason, /signed catalog/i);
  assert.equal(card.repoUrl, 'https://huggingface.co/Qwen/Some-GGUF');
});

test('model present in catalog + classified installable → INSTALL enabled', () => {
  const [card] = toSearchCards([mk('qwen2.5-1.5b-instruct-q4_k_m', true)], ['qwen2.5-1.5b-instruct-q4_k_m']);
  assert.equal(card.installable, true);
  assert.match(card.installReason, /GGUF \+ runtime/);
});

test('in catalog but NOT classified installable (no runtime) → still gated off', () => {
  const [card] = toSearchCards([mk('qwen2.5-1.5b-instruct-q4_k_m', false)], ['qwen2.5-1.5b-instruct-q4_k_m']);
  assert.equal(card.installable, false);
});

test('§15 search integration: ladder verdict + REAL artifact metadata pass through to the card', () => {
  const [card] = toSearchCards([mk('bartowski/Some-Model-GGUF', true, {
    artifact: { ggufFileCount: 6, smallestArtifactBytes: 2300000000, architecture: 'llama', parameters: 3212749888, contextLength: 131072, multimodal: false },
    fit: { verdict: 'FIT', confidence: 'high', reasons: ['ram ✓ declared 6 GB ≤ 16.9 GB measured', 'runtime ✓ llama.cpp healthy'], unknownRungs: [], rungs: [] },
  })], []);
  assert.equal(card.verdict, 'FIT');
  assert.equal(card.parameters, '3.2B');          // real gguf.total, formatted
  assert.equal(card.architecture, 'llama');
  assert.equal(card.context, '131072');
  assert.match(card.size, /2\.30 GB \(smallest GGUF\)/);
  assert.equal(card.runtime, 'llama.cpp');
  // Even though the repo name screams a quant, quantization is NEVER name-guessed:
  assert.equal(card.quantization, 'Unknown');
  assert.equal(card.installable, false);          // fit FIT ≠ catalog membership — install gate unchanged
  assert.match(card.installReason, /signed catalog/i);
});

test('artifact-less discovery (fetch failed) keeps display fields Unknown, not guesses', () => {
  const [card] = toSearchCards([mk('gated/Repo', true)], []);
  assert.equal(card.parameters, 'Unknown');
  assert.equal(card.size, 'Unknown');
  assert.equal(card.architecture, 'Unknown');
  assert.equal(card.verdict, 'POSSIBLE');
});
