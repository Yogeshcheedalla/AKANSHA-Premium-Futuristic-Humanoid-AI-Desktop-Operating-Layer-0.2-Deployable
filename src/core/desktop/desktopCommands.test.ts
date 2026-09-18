import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapToDesktopAction } from './desktopCommands';

test('open/launch/start map to desktop.app.launch with a canonical application', () => {
  assert.deepEqual(mapToDesktopAction('open notepad'), { actionId: 'desktop.app.launch', application: 'notepad' });
  assert.deepEqual(mapToDesktopAction('Launch Calculator'), { actionId: 'desktop.app.launch', application: 'calculator' });
  assert.deepEqual(mapToDesktopAction('start paint.'), { actionId: 'desktop.app.launch', application: 'paint' });
  assert.deepEqual(mapToDesktopAction('open the text editor'), { actionId: 'desktop.app.launch', application: 'notepad' });
});

test('close/quit/terminate map to desktop.app.close', () => {
  assert.deepEqual(mapToDesktopAction('close notepad'), { actionId: 'desktop.app.close', application: 'notepad' });
  assert.deepEqual(mapToDesktopAction('quit calculator'), { actionId: 'desktop.app.close', application: 'calculator' });
  assert.deepEqual(mapToDesktopAction('terminate paint'), { actionId: 'desktop.app.close', application: 'paint' });
});

test('unknown application → null (never invent an executable / never shell out)', () => {
  assert.equal(mapToDesktopAction('open frobnicator'), null);
  assert.equal(mapToDesktopAction('please'), null);
});

test('multi-step / shell-like text is NOT a simple desktop command → null', () => {
  assert.equal(mapToDesktopAction('open notepad and type hello'), null);
  assert.equal(mapToDesktopAction('open notepad; powershell'), null);
  assert.equal(mapToDesktopAction('open notepad && whoami'), null);
  assert.equal(mapToDesktopAction('launch calc then open paint'), null);
});

test('non-launch/close phrasing is not captured', () => {
  assert.equal(mapToDesktopAction('what is the weather'), null);
  assert.equal(mapToDesktopAction('write a report about sales'), null);
});
