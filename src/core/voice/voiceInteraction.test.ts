import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleVoiceKeydown, handleVoiceKeyup, type VoiceShortcutActions } from './voiceShortcuts';
import { transition, isValidTransition, OnceGuard, type VoicePhase, type VoiceEvent } from './voiceStateMachine';

function spy(): VoiceShortcutActions & { calls: string[] } {
  const calls: string[] = [];
  return { calls, toggle: () => { calls.push('toggle'); }, startPushToTalk: () => { calls.push('ptt-start'); }, stopPushToTalk: () => { calls.push('ptt-stop'); }, stop: () => { calls.push('stop'); } };
}

test('Ctrl+Space toggles; Ctrl+Shift+Space starts push-to-talk; release stops it', () => {
  const a = spy();
  handleVoiceKeydown({ code: 'Space', ctrlKey: true }, a);
  assert.deepEqual(a.calls, ['toggle']);
  handleVoiceKeydown({ code: 'Space', ctrlKey: true, shiftKey: true }, a);
  assert.deepEqual(a.calls.slice(-1), ['ptt-start']);
  handleVoiceKeyup({ code: 'Space', ctrlKey: true, shiftKey: true }, a);
  assert.deepEqual(a.calls.slice(-1), ['ptt-stop']);
});

test('Escape stops; auto-repeat is ignored; unrelated keys do nothing', () => {
  const a = spy();
  handleVoiceKeydown({ key: 'Escape', code: 'Escape' }, a);
  assert.deepEqual(a.calls, ['stop']);
  a.calls.length = 0;
  handleVoiceKeydown({ code: 'Space', ctrlKey: true, repeat: true }, a); // held key
  assert.deepEqual(a.calls, [], 'repeat must not re-toggle');
  handleVoiceKeydown({ key: 'a', code: 'KeyA' }, a);
  assert.deepEqual(a.calls, [], 'normal typing untouched');
});

test('voice state machine: full conversation cycle + follow-up', () => {
  const cycle: [VoicePhase, VoiceEvent][] = [
    ['IDLE', 'ACTIVATE'], ['LISTENING', 'FINAL_ASR'], ['TRANSCRIBING', 'TRANSCRIPT_ACCEPTED'],
    ['THINKING', 'RESPONSE_READY'], ['SPEAKING', 'TTS_COMPLETE'], ['WAITING_FOR_FOLLOWUP', 'USER_SPEECH'],
  ];
  let s: VoicePhase = 'IDLE';
  for (const [from, ev] of cycle) { assert.equal(s, from); const n = transition(s, ev); assert.ok(n, `${from}+${ev} invalid`); s = n!; }
  assert.equal(s, 'LISTENING');
});

test('barge-in during SPEAKING → INTERRUPTED → LISTENING; invalid transitions rejected', () => {
  assert.equal(transition('SPEAKING', 'BARGE_IN'), 'INTERRUPTED');
  assert.equal(transition('INTERRUPTED', 'TTS_STOPPED'), 'LISTENING');
  assert.equal(transition('IDLE', 'FINAL_ASR'), null, 'cannot transcribe when idle');
  assert.equal(isValidTransition('THINKING', 'TTS_COMPLETE'), false);
  assert.equal(transition('STOPPING', 'CLEANUP'), 'IDLE');
});

test('OnceGuard: a duplicated id executes at most once', () => {
  const g = new OnceGuard();
  assert.equal(g.claim('utt-1'), true);
  assert.equal(g.claim('utt-1'), false, 'duplicate utterance rejected');
  assert.equal(g.claim('utt-2'), true);
});
