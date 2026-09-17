import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceFromHash } from '@/ui/navigation/useWorkspaceRoute';
import { WORKSPACES, DEFAULT_WORKSPACE, isValidWorkspace } from '@/ui/navigation/workspaces';

test('workspaceFromHash: every real workspace id round-trips from #/app/<id>', () => {
  for (const w of WORKSPACES) {
    assert.equal(workspaceFromHash('#/app/' + w.id), w.id, `${w.id} should be readable from the hash`);
  }
});

test('workspaceFromHash: invalid / malformed / empty hashes fall back to null (caller uses default)', () => {
  assert.equal(workspaceFromHash('#/app/nope'), null, 'unknown id rejected');
  assert.equal(workspaceFromHash('#/app/'), null, 'missing id');
  assert.equal(workspaceFromHash('#/cognitive'), null, 'must be the #/app/<id> form');
  assert.equal(workspaceFromHash(''), null);
  assert.equal(workspaceFromHash(null), null);
  assert.equal(workspaceFromHash(undefined), null);
});

test('canonical list: unique ids + a valid default + isValidWorkspace agrees', () => {
  const ids = WORKSPACES.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique (no duplicate dock keys)');
  assert.ok(ids.includes(DEFAULT_WORKSPACE), 'default must be a real workspace');
  assert.ok(ids.every(isValidWorkspace), 'every listed id is valid');
});

test('dock↔panel sync: the former orphan "devops" is not a navigable workspace', () => {
  // Regression guard: AppClient used to render a 'devops' panel that the dock never
  // surfaced. The canonical list is now the single source of truth, so an id with no
  // panel (or a panel with no dock entry) cannot silently reappear.
  assert.equal(isValidWorkspace('devops'), false);
  assert.equal(workspaceFromHash('#/app/devops'), null);
});
