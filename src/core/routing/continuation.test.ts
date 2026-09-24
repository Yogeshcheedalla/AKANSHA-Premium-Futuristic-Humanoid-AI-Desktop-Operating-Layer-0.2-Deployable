import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTruncated, looksComplete, mergeResponses, continueIfTruncated } from './continuation';
import type { ModelResponse, ChatMessage } from '../models/ModelProvider';

const resp = (content: string, finishReason = 'stop'): ModelResponse => ({
  id: 'r', content, model: 'm', provider: 'p', providerType: 'openai-compatible', finishReason,
});

test('isTruncated only when the provider stopped at the length cap', () => {
  assert.equal(isTruncated('length'), true);
  assert.equal(isTruncated('stop'), false);
  assert.equal(isTruncated(undefined), false);
});

test('looksComplete avoids needless continuation', () => {
  assert.equal(looksComplete('The answer is forty-two.'), true);
  assert.equal(looksComplete('The answer is forty'), false);
  assert.equal(looksComplete('Here is a list:'), false);
  assert.equal(looksComplete('```python\ndef f():'), false); // unclosed code fence
});

test('mergeResponses joins cleanly and removes a duplicated seam', () => {
  // No overlap → a single space joins the pieces.
  assert.equal(mergeResponses('The quick brown', 'fox jumps'), 'The quick brown fox jumps');
  // The tail "beta" repeats at the head of the continuation → de-duped once.
  assert.equal(mergeResponses('alpha beta', 'beta gamma'), 'alpha beta gamma');
  // No duplicated seam is invented when there is none.
  assert.equal(mergeResponses('done', ''), 'done');
});

test('complete first response → no continuation call at all', async () => {
  let calls = 0;
  const out = await continueIfTruncated({
    base: { messages: [{ role: 'user', content: 'hi' } as ChatMessage] },
    first: resp('Done.', 'stop'),
    generate: async () => { calls++; return resp('x'); },
  });
  assert.equal(calls, 0);
  assert.equal(out.continuationUsed, 0);
  assert.equal(out.content, 'Done.');
});

test('truncated response is continued from the exact point and merged (bounded)', async () => {
  const pieces = ['The capital of France is', ' Paris, which lies', ' on the Seine.'];
  let n = 0;
  const out = await continueIfTruncated({
    base: { messages: [{ role: 'user', content: 'Q?' } as ChatMessage], maxTokens: 8 },
    first: { ...resp(pieces[0], 'length'), usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 } },
    maxContinuations: 5,
    generate: async (msgs) => {
      // sanity: continuation preserves the partial as an assistant turn.
      assert.ok(msgs.some((m) => m.role === 'assistant'));
      const next = pieces[++n] ?? '';
      const done = n === pieces.length - 1;
      return { ...resp(next, done ? 'stop' : 'length'), usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } };
    },
  });
  assert.match(out.content, /The capital of France is/);
  assert.match(out.content, /Paris/);
  assert.match(out.content, /Seine/);
  assert.equal(out.truncated, false);
  assert.ok(out.continuationUsed >= 1 && out.continuationUsed <= 5);
  assert.ok(out.madeProgress);
  assert.ok(out.usage && out.usage.totalTokens >= 8, 'token usage accumulates across continuations');
});

test('continuation respects the hard ceiling (never runs away)', async () => {
  let calls = 0;
  const out = await continueIfTruncated({
    base: { messages: [{ role: 'user', content: 'Q?' } as ChatMessage] },
    first: resp('part one', 'length'),
    maxContinuations: 2,
    generate: async () => { calls++; return resp(` more ${calls}`, 'length'); }, // forever truncated
  });
  assert.equal(calls, 2, 'stops after the ceiling');
  assert.equal(out.continuationUsed, 2);
  assert.equal(out.truncated, true, 'honestly reports it is still capped');
});

test('a failed continuation must NOT lose the partial already produced', async () => {
  const out = await continueIfTruncated({
    base: { messages: [{ role: 'user', content: 'Q?' } as ChatMessage] },
    first: resp('Important partial result', 'length'),
    generate: async () => { throw new Error('boom'); },
  });
  assert.equal(out.content, 'Important partial result');
  assert.equal(out.continuationUsed, 0);
});
