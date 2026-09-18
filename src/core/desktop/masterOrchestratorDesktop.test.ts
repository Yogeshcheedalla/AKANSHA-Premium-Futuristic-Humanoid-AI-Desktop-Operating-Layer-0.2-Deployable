import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionRegistry } from '@/core/actions/ActionRegistry';
import { masterOrchestrator } from '@/core/orchestration/MasterOrchestrator';
import { registerDesktopCapabilities } from './desktopCapabilities';
import type { ActionContract } from '@/core/actions/types';

/**
 * Integration: a single allowlisted desktop command MUST reach the machine only
 * by traveling through the Action Fabric (MasterOrchestrator → mapToDesktopAction →
 * ActionRegistry/ActionDispatcher → execute → verify). We prove it by overriding the
 * singleton's desktop contracts with an OBSERVING fake: the orchestrator result can
 * only be COMPLETED if the fabric actually executed + verified our fake's evidence.
 * If someone later wires UI → provider directly (bypassing the fabric), this breaks.
 */
function fakeLaunch(seen: { launched: number }): ActionContract {
  return {
    actionId: 'desktop.app.launch', capabilityId: 'desktop.control', requiresConfirmation: true,
    execute: async (req) => {
      seen.launched++;
      const app = (req.payload || {}).application;
      return { output: { found: true, pid: 7777 }, evidence: { kind: 'process', observed: true, summary: `launched ${app} (pid 7777) [fake]`, data: { app, pid: 7777 } } };
    },
    verify: ({ evidence }) => evidence && evidence.observed
      ? { verified: true, method: 'processObserved', reason: evidence.summary }
      : { verified: false, method: 'processObserved', reason: 'no evidence' },
  };
}
function fakeClose(seen: { closed: number }): ActionContract {
  return {
    actionId: 'desktop.app.close', capabilityId: 'desktop.control', requiresConfirmation: true,
    execute: async (req) => {
      seen.closed++;
      const app = (req.payload || {}).application;
      return { output: { wasRunning: true, closed: true }, evidence: { kind: 'process', observed: true, summary: `closed ${app} [fake]`, data: { app, killedPid: 7777 } } };
    },
    verify: ({ evidence }) => evidence && evidence.observed
      ? { verified: true, method: 'processTerminated', reason: evidence.summary }
      : { verified: false, method: 'processTerminated', reason: 'no evidence' },
  };
}

async function runCommand(text: string) {
  const mission = await masterOrchestrator.createMission(text, { intent: 'command', requestId: `itest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
  return masterOrchestrator.runMission(mission.id);
}

test('"open notepad" is executed + verified through the Action Fabric (COMPLETED)', async () => {
  const seen = { launched: 0, closed: 0 };
  actionRegistry.register(fakeLaunch(seen));
  actionRegistry.register(fakeClose(seen));
  try {
    const m = await runCommand('open notepad');
    assert.equal(seen.launched, 1, 'the fabric must have invoked launch exactly once');
    assert.equal(seen.closed, 0);
    assert.equal(m.status, 'COMPLETED');
    assert.equal(m.context.verification?.verified, undefined); // desktop path stores evidence, not a model verification
    assert.ok(/pid 7777/.test(String(m.context.evidence?.[0]?.summary || m.context.reply)), 'evidence carried through to the mission');
  } finally {
    registerDesktopCapabilities(); // restore the real Windows contracts on the singleton
  }
});

test('"close paint" is executed + verified through the Action Fabric (COMPLETED)', async () => {
  const seen = { launched: 0, closed: 0 };
  actionRegistry.register(fakeLaunch(seen));
  actionRegistry.register(fakeClose(seen));
  try {
    const m = await runCommand('close paint');
    assert.equal(seen.closed, 1);
    assert.equal(seen.launched, 0);
    assert.equal(m.status, 'COMPLETED');
  } finally {
    registerDesktopCapabilities();
  }
});

test('"focus notepad" is executed + verified through the Action Fabric (COMPLETED)', async () => {
  let focused = 0;
  actionRegistry.register({
    actionId: 'desktop.window.focus', capabilityId: 'desktop.control', requiresConfirmation: true,
    execute: async () => {
      focused++;
      return { output: { found: true, foreground: true }, evidence: { kind: 'window', observed: true, summary: 'focused notepad (foreground) [fake]', data: { app: 'notepad', foregroundPid: 42 } } };
    },
    verify: ({ evidence }) => (evidence && evidence.observed && evidence.kind === 'window'
      ? { verified: true, method: 'foregroundObserved', reason: evidence.summary }
      : { verified: false, method: 'foregroundObserved', reason: 'no evidence' }),
  });
  try {
    const m = await runCommand('focus notepad');
    assert.equal(focused, 1, 'the fabric must have invoked focus exactly once');
    assert.equal(m.status, 'COMPLETED');
  } finally {
    registerDesktopCapabilities();
  }
});

test('fabric verification failure NEVER becomes mission success', async () => {
  // A contract that "executes" but returns no observed evidence must not COMPLETED.
  actionRegistry.register({
    actionId: 'desktop.app.launch', capabilityId: 'desktop.control', requiresConfirmation: true,
    execute: async () => ({ output: { found: false }, evidence: { kind: 'process', observed: false, summary: 'nothing observed' } }),
    verify: ({ evidence }) => (evidence && evidence.observed ? { verified: true, method: 'x' } : { verified: false, method: 'x', reason: 'no evidence' }),
  });
  try {
    const m = await runCommand('open notepad');
    assert.equal(m.status, 'FAILED');
    assert.notEqual(m.context.reply?.toLowerCase().includes('done'), true);
  } finally {
    registerDesktopCapabilities();
  }
});
