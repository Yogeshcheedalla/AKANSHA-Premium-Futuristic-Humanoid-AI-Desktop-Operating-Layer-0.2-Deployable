#!/usr/bin/env -S npx tsx
/**
 * release-manifest.ts — turn a freshly built installer into an honest, paste-ready
 * AKANSHA_RELEASES entry by MEASURING its real SHA-256 + byte size from disk.
 *
 *   npx tsx scripts/release-manifest.ts release/Akansha-Setup-3.0.0.exe \
 *       --url https://<hosted-url>/Akansha-Setup-3.0.0.exe \
 *       --platform windows --arch x64 --type installer
 *
 * The SHA-256 is never guessed; it is computed from the actual artifact via the same
 * tested helper the app uses. The manifest at /api/releases then HEAD-verifies the URL,
 * so a button only becomes a real download once the file is genuinely hosted.
 */
import path from 'path';
import { hashFileSync } from '../src/core/releases/artifactIntegrity';

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('usage: tsx scripts/release-manifest.ts <artifact-file> --url <public-url> [--platform windows] [--arch x64] [--type installer]');
    process.exit(2);
  }
  const { sha256, size } = hashFileSync(path.resolve(file));
  const entry = {
    platform: arg('platform', 'windows'),
    architecture: arg('arch', 'x64'),
    type: arg('type', 'installer'),
    filename: path.basename(file),
    url: arg('url') || 'https://REPLACE-WITH-HOSTED-URL/' + path.basename(file),
    sha256,
    size,
  };
  console.log(`# measured from ${file}: ${sha256}  (${size} bytes, ${(size / 1048576).toFixed(1)} MB)`);
  console.log(`# set this Vercel env var (Production), then redeploy:`);
  console.log(`AKANSHA_RELEASES=${JSON.stringify([entry])}`);
}

main();
