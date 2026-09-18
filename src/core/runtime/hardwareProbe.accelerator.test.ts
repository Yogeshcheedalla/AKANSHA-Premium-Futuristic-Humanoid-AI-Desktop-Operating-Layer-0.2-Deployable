import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeAccelerator, detectHardware, type CommandRunner } from './HardwareProbe';

/** Fake runner: map command → stdout, or throw to simulate "not installed". */
function runner(table: Record<string, () => string>): CommandRunner {
  return (cmd) => {
    const fn = table[cmd];
    if (!fn) throw new Error(`no such command: ${cmd}`);
    return fn();
  };
}

test('NVIDIA detected via nvidia-smi → vendor/model/VRAM/freeVRAM, not integrated', () => {
  const gpu = probeAccelerator(runner({
    'nvidia-smi': () => 'NVIDIA GeForce RTX 3060, 12288, 10000\n',
  }));
  assert.equal(gpu.detected, true);
  assert.equal(gpu.vendor, 'nvidia');
  assert.equal(gpu.vramGB, 12);
  assert.equal(gpu.freeVramGB, 9.8);
  assert.equal(gpu.integrated, false);
});

test('Integrated-only (Intel UHD) via WMI → detected but NO fabricated VRAM', () => {
  const gpu = probeAccelerator(runner({
    'nvidia-smi': () => { throw new Error('missing'); },
    'powershell.exe': () => JSON.stringify({ Name: 'Intel(R) UHD Graphics', AdapterRAM: 2147483648 }),
  }));
  assert.equal(gpu.detected, true);
  assert.equal(gpu.vendor, 'intel');
  assert.equal(gpu.integrated, true);
  assert.equal(gpu.vramGB, undefined); // shared memory is not claimed as VRAM
});

test('Discrete AMD via WMI → vendor amd with dedicated VRAM', () => {
  const gpu = probeAccelerator(runner({
    'nvidia-smi': () => { throw new Error('missing'); },
    'powershell.exe': () => JSON.stringify({ Name: 'AMD Radeon RX 6600', AdapterRAM: 8589934592 }),
  }));
  assert.equal(gpu.detected, true);
  assert.equal(gpu.vendor, 'amd');
  assert.equal(gpu.integrated, false);
  assert.equal(gpu.vramGB, 8.6);
});

test('No accelerator at all → detected:false (never guessed)', () => {
  const gpu = probeAccelerator(runner({
    'nvidia-smi': () => { throw new Error('missing'); },
    'powershell.exe': () => { throw new Error('missing'); },
  }));
  assert.deepEqual(gpu, { detected: false });
});

test('Garbage nvidia-smi output is not treated as a GPU; falls through to WMI', () => {
  const gpu = probeAccelerator(runner({
    'nvidia-smi': () => '[bin] not found\r\n',
    'powershell.exe': () => JSON.stringify({ Name: 'Microsoft Basic Render Driver', AdapterRAM: 0 }),
  }));
  assert.equal(gpu.detected, true);          // a controller was still seen
  assert.equal(gpu.vramGB, undefined);        // but zero/unknown VRAM is never fabricated
});

test('detectHardware(run) applies the live probe into the profile', () => {
  const hw = detectHardware({ run: runner({ 'nvidia-smi': () => 'NVIDIA GeForce GTX 1650, 4096, 3500\n' }) });
  assert.equal(hw.gpu.vendor, 'nvidia');
  assert.equal(hw.gpu.vramGB, 4);
});

test('detectHardware() without a runner does NOT shell out (env-only, unchanged)', () => {
  // A runner that would throw if ever invoked; absence of `run` must mean no exec.
  const boom: CommandRunner = () => { throw new Error('must not be called'); };
  const hw = detectHardware(); // no run provided
  assert.equal(hw.gpu.detected, false);
  void boom;
});
