import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveApp, expandEnv } from './appRegistry';
import type { ComputerUseProvider, WindowObservation, ProcessCloseResult } from './types';

const execFileAsync = promisify(execFile);

/**
 * PowerShell + UI Automation worker.
 *
 * Reads ONE JSON operation from stdin and writes ONE JSON result to stdout.
 * It performs REAL machine operations (launch a process, bring its window to
 * the foreground, send keystrokes, read the focused edit control's text via
 * UI Automation). No values are interpolated into the shell command line —
 * everything is passed as JSON on stdin, so there is no command-injection path.
 */
const PS_WORKER = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AkanshaWin32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
$root = $AE::RootElement

function Find-ByPid([int]$procId) {
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $procId)
  return $root.FindFirst($TS::Children, $cond)
}
function Find-ByTitle([string]$rx) {
  if (-not $rx) { return $null }
  $all = $root.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $all) {
    try { if ($w.Current.Name -match $rx) { return $w } } catch {}
  }
  return $null
}
function Read-EditText($win) {
  if (-not $win) { return '' }
  # Notepad & many apps expose text via a Document control readable only through
  # TextPattern; others use an Edit control with a Value. Check both, TextPattern first.
  $candidates = @()
  foreach ($ct in @($CT::Edit, $CT::Document)) {
    $found = $win.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $ct)))
    foreach ($c in $found) { $candidates += $c }
  }
  foreach ($c in $candidates) {
    try {
      $pt = $c.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      $t = $pt.DocumentRange.GetText(-1)
      if ($t) { return [string]$t }
    } catch {}
    try { $v = [string]$c.Current.Value; if ($v) { return $v } } catch {}
  }
  return ''
}
function Out($obj) { Write-Output ($obj | ConvertTo-Json -Compress -Depth 6) }

$raw = ''
if ($args.Count -ge 1) {
  try { $raw = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($args[0])) } catch { $raw = '' }
}
if ([string]::IsNullOrWhiteSpace($raw)) { Out @{ ok=$false; error='no input' }; return }
$req = $raw | ConvertFrom-Json
$action = $req.action

try {
  if ($action -eq 'probe') {
    Out @{ ok=$true; platform='windows'; uia=$true }
    return
  }

  if ($action -eq 'listWindows') {
    $titles = @()
    $all = $root.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($w in $all) { try { if ($w.Current.Name) { $titles += $w.Current.Name } } catch {} }
    Out @{ ok=$true; windows=$titles }
    return
  }

  if ($action -eq 'launch') {
    $exe = $req.exe
    $proc = $null
    if ($req.arguments -and @($req.arguments).Count -gt 0) {
      $proc = Start-Process $exe -ArgumentList @($req.arguments) -PassThru
    } else {
      $proc = Start-Process $exe -PassThru
    }
    $launchedPid = $proc.Id
    $titleHint = $req.titleHint
    $found = $null; $title = $null; $realPid = $null
    for ($i = 0; $i -lt [int]$req.pollIterations; $i++) {
      Start-Sleep -Milliseconds ([int]$req.pollIntervalMs)
      $w = $null
      if ($req.launch -eq 'win32' -and $launchedPid) { $w = Find-ByPid ([int]$launchedPid) }
      if (-not $w -and $titleHint) { $w = Find-ByTitle $titleHint }
      if ($w) { $found = $w; $title = $w.Current.Name; try { $realPid = $w.Current.ProcessId } catch {}; break }
    }
    # A process may exist even before a window appears (browser first-run).
    $procAlive = $false
    if ($launchedPid) { try { if (Get-Process -Id $launchedPid -ErrorAction Stop) { $procAlive = $true } } catch {} }
    Out @{ ok=([bool]$found -or $procAlive); found=[bool]$found; processAlive=$procAlive; pid=$realPid; title=$title }
    return
  }

  if ($action -eq 'processExists') {
    $names = @($req.processNames)
    $running = @()
    foreach ($n in $names) {
      $p = @(Get-Process -Name $n -ErrorAction SilentlyContinue)
      if ($p.Count -gt 0) { $running += @{ name=$n; count=$p.Count; pid=$p[0].Id } }
    }
    Out @{ ok=($running.Count -gt 0); running=$running }
    return
  }

  if ($action -eq 'close') {
    $procName = $req.processName
    if (-not $procName) { Out @{ ok=$false; closed=$false; error='no process name' }; return }
    $before = @(Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    if ($before.Count -eq 0) {
      # Nothing was running — cannot claim we closed something.
      Out @{ ok=$false; closed=$false; wasRunning=$false; remaining=@() }
      return
    }
    Stop-Process -Id $before -Force -ErrorAction SilentlyContinue
    $remaining = @()
    for ($i = 0; $i -lt [int]$req.pollIterations; $i++) {
      Start-Sleep -Milliseconds ([int]$req.pollIntervalMs)
      $p = @(Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
      if ($p.Count -eq 0) { $remaining = @(); break } else { $remaining = $p }
    }
    $gone = ($remaining.Count -eq 0)
    Out @{ ok=$gone; closed=$gone; wasRunning=$true; killedPid=$before[0]; remaining=$remaining }
    return
  }

  if ($action -eq 'observe') {
    $w = $null
    if ($req.pid) { $w = Find-ByPid ([int]$req.pid) }
    if (-not $w -and $req.titleHint) { $w = Find-ByTitle $req.titleHint }
    $text = Read-EditText $w
    $title = if ($w) { $w.Current.Name } else { $null }
    Out @{ ok=[bool]$w; found=[bool]$w; title=$title; text=$text }
    return
  }

  if ($action -eq 'focus') {
    $w = Find-ByTitle $req.titleHint
    $t = $null; $fg = $false; $fgPid = $null; $tgtPid = $null
    if ($w) {
      $hwnd = $w.Current.NativeWindowHandle
      $tgtPid = $w.Current.ProcessId
      $t = $w.Current.Name
      for ($i = 0; $i -lt 10; $i++) {
        [void][AkanshaWin32]::ShowWindowAsync($hwnd, 9)      # SW_RESTORE
        # Synthetic ALT tap defeats the SetForegroundWindow foreground lock.
        [AkanshaWin32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
        [AkanshaWin32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
        [void][AkanshaWin32]::SetForegroundWindow($hwnd)
        Start-Sleep -Milliseconds 220
        $fgw = [AkanshaWin32]::GetForegroundWindow()
        try { $fgPid = $AE::FromHandle($fgw).Current.ProcessId } catch { $fgPid = $null }
        # Reliable signal: the foreground WINDOW itself is the target window handle.
        if ([long]$fgw -eq [long]$hwnd) { $fg = $true; break }
      }
    }
    Out @{ ok=$fg; found=[bool]$w; foreground=$fg; title=$t; foregroundPid=$fgPid; targetPid=$tgtPid }
    return
  }

  if ($action -eq 'type') {
    $w = Find-ByTitle $req.titleHint
    $t = $null
    if ($w) {
      [void][AkanshaWin32]::SetForegroundWindow($w.Current.NativeWindowHandle)
      Start-Sleep -Milliseconds 350
      [System.Windows.Forms.SendKeys]::SendWait($req.text)
      Start-Sleep -Milliseconds 500
      $t = $w.Current.Name
    }
    $text = Read-EditText $w
    Out @{ ok=[bool]$w; found=[bool]$w; title=$t; text=$text }
    return
  }

  if ($action -eq 'key') {
    $w = Find-ByTitle $req.titleHint
    $t = $null
    if ($w) {
      [void][AkanshaWin32]::SetForegroundWindow($w.Current.NativeWindowHandle)
      Start-Sleep -Milliseconds 300
      [System.Windows.Forms.SendKeys]::SendWait($req.keys)
      Start-Sleep -Milliseconds 400
      $t = $w.Current.Name
    }
    Out @{ ok=[bool]$w; found=[bool]$w; title=$t }
    return
  }

  if ($action -eq 'click') {
    $w = Find-ByTitle $req.titleHint
    $clicked = $false
    if ($w) {
      [void][AkanshaWin32]::SetForegroundWindow($w.Current.NativeWindowHandle)
      $cond = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $req.target)
      $el = $w.FindFirst($TS::Descendants, $cond)
      if (-not $el) {
        $el = $w.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Button)))
      }
      if ($el) {
        try {
          $p = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $p.Invoke()
          $clicked = $true
        } catch {}
      }
    }
    Out @{ ok=$clicked; found=$clicked }
    return
  }

  if ($action -eq 'scroll') {
    $w = Find-ByTitle $req.titleHint
    if ($w) {
      [void][AkanshaWin32]::SetForegroundWindow($w.Current.NativeWindowHandle)
      $key = if ($req.direction -eq 'up') { '{PGUP}' } else { '{PGDN}' }
      $n = [int]$req.amount
      if ($n -lt 1) { $n = 1 }
      for ($j = 0; $j -lt $n; $j++) { [System.Windows.Forms.SendKeys]::SendWait($key) }
    }
    Out @{ ok=[bool]$w; found=[bool]$w }
    return
  }

  Out @{ ok=$false; error=('unknown action: ' + $action) }
} catch {
  Out @{ ok=$false; error=$_.Exception.Message }
}
`;

function toUtf16Base64(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

interface PsResult {
  ok?: boolean;
  found?: boolean;
  pid?: number;
  title?: string | null;
  text?: string;
  windows?: string[];
  error?: string;
  // 'close' observation fields
  closed?: boolean;
  wasRunning?: boolean;
  killedPid?: number;
  remaining?: number[];
  // 'focus' observation fields
  foreground?: boolean;
  foregroundPid?: number;
  targetPid?: number;
  // 'launch' / 'processExists' fields
  processAlive?: boolean;
  running?: { name: string; count: number; pid: number }[];
}

export class WindowsComputerUseProvider implements ComputerUseProvider {
  readonly id = 'windows-computer-use';
  private available: boolean | null = null;
  private _scriptPath: string | null = null;

  private scriptPath(): string {
    if (this._scriptPath) return this._scriptPath;
    const dir = path.join(os.tmpdir(), 'akansha-exec');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'worker.ps1');
    fs.writeFileSync(file, PS_WORKER, 'utf8');
    this._scriptPath = file;
    return file;
  }

  private async run(op: Record<string, unknown>): Promise<PsResult> {
    const b64 = Buffer.from(JSON.stringify(op), 'utf8').toString('base64');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', this.scriptPath(), b64],
      { timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }
    );
    const line = stdout.trim().split('\n').filter(Boolean).pop() || '{}';
    try {
      return JSON.parse(line) as PsResult;
    } catch {
      return { ok: false, error: 'unparseable provider output' };
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    if (process.platform !== 'win32') {
      this.available = false;
      return false;
    }
    try {
      const r = await this.run({ action: 'probe' });
      this.available = !!r.ok;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  private spec(app: string) {
    return resolveApp(app);
  }

  async launch(app: string): Promise<WindowObservation> {
    const spec = this.spec(app);
    if (!spec) {
      return { found: false, windows: undefined };
    }
    const r = await this.run({
      action: 'launch',
      exe: expandEnv(spec.exe),
      titleHint: spec.titleHint,
      launch: spec.launch,
      pollIterations: 14,
      pollIntervalMs: 400,
    });
    return { found: !!r.found, pid: r.pid ?? undefined, title: r.title ?? undefined };
  }

  /** Launch a RESOLVED executable with typed arguments (e.g. a URL). Never shell text. */
  async launchExe(exe: string, args: string[], titleHint: string): Promise<WindowObservation & { processAlive?: boolean }> {
    const r = await this.run({
      action: 'launch',
      exe,
      arguments: args,
      titleHint,
      launch: 'win32',
      pollIterations: 24,
      pollIntervalMs: 500,
    });
    return { found: !!r.found, processAlive: !!r.processAlive, pid: r.pid ?? undefined, title: r.title ?? undefined };
  }

  /** True if any named process is currently running (verifies the SPECIFIC browser). */
  async processExists(processNames: string[]): Promise<{ running: boolean; pid?: number }> {
    const r = await this.run({ action: 'processExists', processNames });
    const first = Array.isArray(r.running) ? r.running[0] : null;
    return { running: !!r.ok, pid: first?.pid };
  }

  /** Terminate a running allowlisted application by process name and OBSERVE that it is gone. */
  async close(app: string): Promise<ProcessCloseResult> {
    const spec = this.spec(app);
    if (!spec || !spec.processName) {
      return { wasRunning: false, closed: false, remainingPids: [] };
    }
    const r = await this.run({
      action: 'close',
      processName: spec.processName,
      titleHint: spec.titleHint,
      pollIterations: 12,
      pollIntervalMs: 350,
    });
    return {
      wasRunning: !!r.wasRunning,
      closed: !!r.closed,
      killedPid: r.killedPid ?? undefined,
      remainingPids: Array.isArray(r.remaining) ? r.remaining : [],
    };
  }

  async focus(target: string): Promise<WindowObservation> {
    const spec = this.spec(target);
    const r = await this.run({ action: 'focus', titleHint: spec ? spec.titleHint : target });
    return {
      found: !!r.found,
      title: r.title ?? undefined,
      foreground: !!r.foreground,
      foregroundPid: r.foregroundPid ?? undefined,
      targetPid: r.targetPid ?? undefined,
    };
  }

  async observe(target?: string): Promise<WindowObservation> {
    const spec = target ? this.spec(target) : null;
    const r = await this.run({ action: 'observe', titleHint: spec ? spec.titleHint : target });
    return { found: !!r.found, title: r.title ?? undefined, text: r.text };
  }

  async type(text: string, target?: string): Promise<WindowObservation> {
    const spec = target ? this.spec(target) : null;
    const r = await this.run({
      action: 'type',
      text,
      titleHint: spec ? spec.titleHint : target,
    });
    return { found: !!r.found, title: r.title ?? undefined, text: r.text };
  }

  async key(keys: string, target?: string): Promise<WindowObservation> {
    const spec = target ? this.spec(target) : null;
    const r = await this.run({ action: 'key', keys, titleHint: spec ? spec.titleHint : target });
    return { found: !!r.found, title: r.title ?? undefined };
  }

  async click(target: string, double?: boolean): Promise<WindowObservation> {
    const r = await this.run({ action: 'click', target, double: !!double });
    return { found: !!r.found };
  }

  async scroll(direction: 'up' | 'down', amount = 3, target?: string): Promise<WindowObservation> {
    const spec = target ? this.spec(target) : null;
    const r = await this.run({ action: 'scroll', direction, amount, titleHint: spec ? spec.titleHint : target });
    return { found: !!r.found };
  }

  async listWindows(): Promise<string[]> {
    const r = await this.run({ action: 'listWindows' });
    return r.windows || [];
  }
}

export const windowsComputerUseProvider = new WindowsComputerUseProvider();
