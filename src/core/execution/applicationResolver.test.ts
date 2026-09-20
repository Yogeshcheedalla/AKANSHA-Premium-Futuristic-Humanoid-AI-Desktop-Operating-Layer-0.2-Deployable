import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSite, isSafeUrl } from './applicationResolver';

test('known sites resolve to real https URLs', () => {
  assert.equal(resolveSite('youtube'), 'https://www.youtube.com/');
  assert.equal(resolveSite('gmail'), 'https://mail.google.com/');
  assert.equal(resolveSite('GitHub'), 'https://github.com/');
});

test('unknown single token becomes a best-effort https host; phrases do not', () => {
  assert.equal(resolveSite('spotify'), 'https://www.spotify.com/');
  assert.equal(resolveSite('my cat'), null);
});

test('isSafeUrl accepts http(s) and rejects shell metacharacters', () => {
  assert.equal(isSafeUrl('https://example.com/x'), true);
  assert.equal(isSafeUrl('http://example.com'), true);
  assert.equal(isSafeUrl('javascript:alert(1)'), false);
  assert.equal(isSafeUrl('https://x.com/;rm -rf'), false);
  assert.equal(isSafeUrl('not a url'), false);
});
