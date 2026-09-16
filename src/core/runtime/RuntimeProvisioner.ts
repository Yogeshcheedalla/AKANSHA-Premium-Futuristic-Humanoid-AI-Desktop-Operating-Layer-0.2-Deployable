/**
 * RuntimeProvisioner — installs a TRUSTED inference runtime (llama.cpp) into an
 * Akansha-controlled directory. Same integrity posture as models: HTTPS download →
 * SHA-256 verify against a PINNED digest → extract → the caller then validates the
 * binary actually launches (RuntimeManager.detectRuntimes). It NEVER runs a
 * downloaded binary here and NEVER trusts a file's mere presence.
 *
 * fetcher + extractor are injectable so this is unit-tested offline (no network,
 * no real archive) and honestly reflects what production does.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';

export interface PinnedRuntime {
  version: string;               // e.g. 'b10809'
  url: string;                   // https release asset
  sha256: string;                // 64-hex, from the release's published SHA256SUMS (pinned, never guessed)
  sizeBytes: number;
  binaryRelativePath: string;    // e.g. 'llama-b10809-bin-win-cpu-x64/llama-cli.exe'
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;
export type Extractor = (zipBytes: Uint8Array, destDir: string) => Promise<void>;

export interface ProvisionResult {
  ok: boolean;
  binaryPath?: string;
  version?: string;
  reason?: string;
  sha256?: string;
}

async function defaultFetcher(url: string): Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
  return { ok: res.ok, status: res.status, arrayBuffer: () => res.arrayBuffer() };
}

/**
 * Default extractor. On Windows use the native PowerShell Expand-Archive (Git-Bash
 * `tar` mangles `C:/…` paths); elsewhere prefer unzip, then bsdtar. Writes the zip
 * to a temp file with native path separators so no shell rewrites it.
 */
async function defaultExtractor(zipBytes: Uint8Array, destDir: string): Promise<void> {
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'akan-rt-'));
  const zip = join(dir, 'runtime.zip');
  await writeFile(zip, zipBytes);
  mkdirSync(destDir, { recursive: true });
  const run = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });
  if (process.platform === 'win32') {
    await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${destDir}' -Force`]);
    return;
  }
  try { await run('unzip', ['-o', zip, '-d', destDir]); }
  catch { await run('tar', ['-xf', zip, '-C', destDir]); }
}

export function sha256Hex(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * @param expected optional override of the pinned sha (tests); defaults to pinned.sha256.
 * @returns computed sha even on failure so a caller can PIN a new version honestly.
 */
export async function provisionRuntime(opts: {
  pinned: PinnedRuntime;
  destDir: string;
  fetcher?: Fetcher;
  extractor?: Extractor;
  allowInsecureUrl?: boolean;
}): Promise<ProvisionResult> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const extractor = opts.extractor ?? defaultExtractor;
  const { pinned, destDir } = opts;

  if (!/^https:\/\//i.test(pinned.url)) return { ok: false, reason: 'insecure-url' };
  if (!/^[a-f0-9]{64}$/i.test(pinned.sha256)) return { ok: false, reason: 'no-pinned-checksum' };

  let res;
  try { res = await fetcher(pinned.url); } catch (e: any) { return { ok: false, reason: 'download-failed:' + (e?.message || e) }; }
  if (!res.ok) return { ok: false, reason: `download-http-${res.status}` };

  const bytes = new Uint8Array(await res.arrayBuffer());
  const actual = sha256Hex(bytes);
  if (actual.toLowerCase() !== pinned.sha256.toLowerCase()) {
    return { ok: false, reason: 'checksum-mismatch', sha256: actual };
  }
  if (Number.isFinite(pinned.sizeBytes) && pinned.sizeBytes > 0 && bytes.length !== pinned.sizeBytes) {
    return { ok: false, reason: `size-mismatch:${bytes.length}!=${pinned.sizeBytes}`, sha256: actual };
  }
  try { await extractor(bytes, destDir); } catch (e: any) { return { ok: false, reason: 'extract-failed:' + (e?.message || e), sha256: actual }; }

  const { join } = await import('node:path');
  const binaryPath = join(destDir, pinned.binaryRelativePath);
  if (!existsSync(binaryPath)) return { ok: false, reason: 'binary-not-found:' + pinned.binaryRelativePath, sha256: actual };
  return { ok: true, binaryPath, version: pinned.version, sha256: actual };
}
