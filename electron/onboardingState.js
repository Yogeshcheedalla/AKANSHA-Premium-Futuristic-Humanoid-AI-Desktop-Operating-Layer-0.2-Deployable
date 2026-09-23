// electron/onboardingState.js — durable desktop onboarding state.
//
// Root cause fixed here: Electron picks a random backend port each launch
// (findFreePort), so the renderer origin (http://127.0.0.1:<port>) changes and
// per-origin localStorage is wiped — FirstRunOnboarding reappeared every start.
// The authoritative "has this install completed onboarding?" flag therefore
// lives in Electron userData as a small JSON file, independent of port/origin.
//
// Rules honored: survives restart / port change / renderer reload / app update;
// missing file => NOT onboarded; malformed file => recoverable (never silently
// marked complete); atomic write; no secrets stored; version change does NOT
// force onboarding again.

const fs = require('node:fs');
const path = require('node:path');

const FILE = 'onboarding-state.json';
const VERSION = 1;

function statePath(userDataDir) {
  return path.join(userDataDir, FILE);
}

/** Read the durable onboarding state. Never throws; missing/malformed => not onboarded. */
function readOnboarding(userDataDir) {
  const p = statePath(userDataDir);
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return { onboarded: false, version: 0, completedAt: null, recoverable: false };
  }
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && obj.onboarded === true) {
      return {
        onboarded: true,
        version: typeof obj.version === 'number' ? obj.version : VERSION,
        completedAt: typeof obj.completedAt === 'string' ? obj.completedAt : null,
        recoverable: false,
      };
    }
    // Parsed but not onboarded:true — treat as not completed, not corrupt.
    return { onboarded: false, version: 0, completedAt: null, recoverable: false };
  } catch {
    // Malformed JSON — recoverable: show onboarding again, do NOT pretend complete.
    return { onboarded: false, version: 0, completedAt: null, recoverable: true };
  }
}

/** Atomically persist onboarding completion. Returns the written state. */
function completeOnboarding(userDataDir, appVersion) {
  const state = {
    onboarded: true,
    version: VERSION,
    completedAt: new Date().toISOString(),
    appVersion: typeof appVersion === 'string' ? appVersion : null,
  };
  fs.mkdirSync(userDataDir, { recursive: true });
  const p = statePath(userDataDir);
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, p); // atomic on same volume
  return { onboarded: true, version: VERSION, completedAt: state.completedAt, recoverable: false };
}

module.exports = { statePath, readOnboarding, completeOnboarding, FILE, VERSION };
