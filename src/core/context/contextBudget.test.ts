import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetContext, estimateTokens, estimateMessagesTokens } from './contextBudget';
import type { ChatMessage } from '../models/ModelProvider';

const turn = (role: ChatMessage['role'], content: string): ChatMessage => ({ role, content });

test('no context window → never guess; messages returned untouched', () => {
  const msgs = [turn('user', 'a'.repeat(100000))];
  const r = budgetContext({ messages: msgs, contextWindow: undefined });
  assert.equal(r.trimmed, false);
  assert.equal(r.messages, msgs);
});

test('conversation within budget is left intact', () => {
  const msgs = [turn('system', 'You are helpful.'), turn('user', 'hi'), turn('assistant', 'hello')];
  const r = budgetContext({ messages: msgs, contextWindow: 8000, reserveForReply: 500 });
  assert.equal(r.trimmed, false);
  assert.equal(r.droppedTurns, 0);
});

test('over-budget conversation keeps system + newest turns and adds an honest digest', () => {
  const long = 'x'.repeat(4000); // ~1000 tokens each
  const msgs: ChatMessage[] = [
    turn('system', 'SYSTEM RULE that must survive'),
    turn('user', 'oldest ' + long),
    turn('assistant', 'old reply ' + long),
    turn('user', 'newest question'),
  ];
  const r = budgetContext({ messages: msgs, contextWindow: 1200, reserveForReply: 200 });
  assert.equal(r.trimmed, true);
  assert.ok(r.droppedTurns >= 1);
  assert.ok(r.summarized);
  // System instruction survives verbatim.
  assert.ok(r.messages.some((m) => m.role === 'system' && m.content.includes('SYSTEM RULE that must survive')));
  // A single digest line describes what was omitted — no fabricated content.
  const digest = r.messages.find((m) => m.role === 'system' && m.content.includes('Conversation summary'));
  assert.ok(digest, 'an extractive digest was inserted');
  // The most-recent user question is preserved.
  assert.ok(r.messages.some((m) => m.content.includes('newest question')));
  assert.ok(r.estimatedInputTokens <= 1200);
});

test('estimateTokens is monotonic in length and empty-safe', () => {
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('a'.repeat(40)) < estimateTokens('a'.repeat(400)));
  assert.ok(estimateMessagesTokens([]) === 0);
});

test('maxInputTokens provides a hard cap even under a generous window', () => {
  const msgs: ChatMessage[] = [turn('user', 'y'.repeat(20000)), turn('assistant', 'z'.repeat(20000)), turn('user', 'last')];
  const r = budgetContext({ messages: msgs, contextWindow: 200000, maxInputTokens: 300, reserveForReply: 0 });
  assert.equal(r.trimmed, true);
  assert.ok(r.estimatedInputTokens <= 300 + 64, `got ${r.estimatedInputTokens}`);
});
