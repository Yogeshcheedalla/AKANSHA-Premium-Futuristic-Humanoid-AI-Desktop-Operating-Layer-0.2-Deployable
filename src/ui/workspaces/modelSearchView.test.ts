import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSearchCards } from './modelSearchView';
import type { RankedDiscoveredModel } from '@/core/models/discovery/modelDiscovery';

const mk = (id: string, installable: boolean, over: Partial<RankedDiscoveredModel> = {}): RankedDiscoveredModel => ({
  id, author: id.split('/')[0], downloads: 100, likes: 5, tags: ['gguf'], isGguf: true,
  repoUrl: `https://huggingface.co/${id}`, source: 'huggingface',
  classification: { installable, formatSupported: true, runtimeSupported: installable, reason: installable ? 'GGUF + runtime' : 'no runtime' },
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
