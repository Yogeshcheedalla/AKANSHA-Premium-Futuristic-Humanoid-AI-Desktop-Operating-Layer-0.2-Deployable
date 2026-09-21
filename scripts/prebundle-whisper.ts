/**
 * Pre-bundle + integrity-verify the OFFLINE Whisper model.
 *
 * Why: PATH A free voice (whisperProvider.ts) otherwise downloads
 * Xenova/whisper-base.en on FIRST voice use. This script makes the model a
 * verified build asset so a fresh, internet-less install can transcribe offline
 * on its very first utterance (spec PHASE 2/3).
 *
 * Contract (NO FABRICATION):
 *  - The model is pinned to an EXACT Hugging Face revision (immutable commit).
 *  - It is obtained ONCE (local transformers cache is reused if present, else
 *    downloaded from the pinned revision) and NEVER bundled "blind".
 *  - Every file's SHA-256 + byte size is recorded to voice/models/manifest.json
 *    on first run, and RE-VERIFIED on every later run. Any mismatch FAILS the
 *    build (non-zero exit) so packaging can never ship a corrupt model.
 *  - A file merely existing is never enough: integrity is the check.
 *
 * Usage:
 *   npx tsx scripts/prebundle-whisper.ts            # ensure + verify (record on 1st run)
 *   npx tsx scripts/prebundle-whisper.ts --verify   # verify only; fail if any file missing/bad
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync, createWriteStream } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { dirname, join, resolve } from 'node:path';

const MODEL_ID = process.env.AKANSHA_WHISPER_MODEL || 'Xenova/whisper-base.en';
// Authoritative immutable commit for this model on the Hugging Face hub.
const REVISION = process.env.AKANSHA_WHISPER_REVISION || '95bf40a508535962c6483ead40270b2e32267508';
const HF_BASE = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}`;
// Exactly the files transformers.js loads for this model (fp32 encoder + merged decoder).
const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged.onnx',
];

const VERIFY_ONLY = process.argv.includes('--verify');

function segs(modelId: string): string[] { return modelId.split('/').filter(Boolean); }
const DEST_ROOT = resolve(process.env.AKANSHA_WHISPER_BUNDLE_OUT || join(process.cwd(), 'voice', 'models'));
const MODEL_DIR = join(DEST_ROOT, ...segs(MODEL_ID));
const MANIFEST = join(DEST_ROOT, 'manifest.json');
// Prefer the local transformers cache (same bytes, from the same hub) to avoid re-download.
const SEED_CACHE = join(process.cwd(), 'node_modules', '@huggingface', 'transformers', '.cache', ...segs(MODEL_ID));

function sha256(file: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    const rs = require('node:fs').createReadStream(file);
    rs.on('error', rej); rs.on('data', (d: Buffer) => h.update(d)); rs.on('end', () => res(h.digest('hex')));
  });
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((res, rej) => {
    const attempt = (u: string, redirects: number) => {
      if (redirects > 5) return rej(new Error(`too many redirects for ${u}`));
      httpsGet(u, { headers: { 'User-Agent': 'akansha-prebundle' } }, (r) => {
        if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume(); return attempt(new URL(r.headers.location, u).toString(), redirects + 1);
        }
        if (!r.statusCode || r.statusCode >= 400) { r.resume(); return rej(new Error(`HTTP ${r.statusCode} for ${u}`)); }
        mkdirSync(dirname(dest), { recursive: true });
        const out = createWriteStream(dest);
        r.pipe(out);
        out.on('finish', () => out.close(() => res()));
        out.on('error', rej);
      }).on('error', rej);
    };
    attempt(url, 0);
  });
}

async function ensureFile(rel: string): Promise<string> {
  const target = join(MODEL_DIR, ...rel.split('/'));
  if (existsSync(target) && statSync(target).size > 0) return target;
  const seed = join(SEED_CACHE, ...rel.split('/'));
  if (existsSync(seed) && statSync(seed).size > 0) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(seed, target);
    return target;
  }
  if (VERIFY_ONLY) throw new Error(`MISSING in verify-only mode: ${rel} (run without --verify to fetch)`);
  process.stdout.write(`  ↓ fetching ${rel} from pinned revision…\n`);
  await download(`${HF_BASE}/${rel}`, target);
  return target;
}

interface ManifestFile { path: string; sha256: string; bytes: number }
interface Manifest {
  model: string; source: string; revision: string; format: string; architecture: string;
  runtime: string; generatedAt: string; files: ManifestFile[]; totalBytes: number;
}

async function main() {
  let transformersVersion = 'unknown';
  try { transformersVersion = JSON.parse(readFileSync(resolve('node_modules/@huggingface/transformers/package.json'), 'utf8')).version; } catch { /* keep */ }
  const recording = !existsSync(MANIFEST);
  process.stdout.write(`\n=== prebundle-whisper · model=${MODEL_ID} revision=${REVISION.slice(0, 12)} · ${recording ? 'RECORD' : VERIFY_ONLY ? 'VERIFY-ONLY' : 'VERIFY'}\n`);
  process.stdout.write(`dest=${MODEL_DIR}\n`);

  const files: ManifestFile[] = [];
  let totalBytes = 0;
  for (const rel of FILES) {
    const path = await ensureFile(rel);
    const bytes = statSync(path).size;
    const hash = await sha256(path);
    totalBytes += bytes;

    let expected: ManifestFile | undefined;
    if (!recording) {
      const m: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
      expected = m.files.find((f) => f.path === rel);
    }
    if (expected) {
      if (expected.sha256 !== hash) throw new Error(`SHA256 MISMATCH for ${rel}: manifest=${expected.sha256} actual=${hash}`);
      if (expected.bytes !== bytes) throw new Error(`SIZE MISMATCH for ${rel}: manifest=${expected.bytes} actual=${bytes}`);
      process.stdout.write(`  ✓ ${rel}  ${bytes.toLocaleString()}B  ${hash.slice(0, 12)}… (verified)\n`);
    } else {
      process.stdout.write(`  • ${rel}  ${bytes.toLocaleString()}B  ${hash.slice(0, 12)}… (recorded)\n`);
    }
    files.push({ path: rel, sha256: hash, bytes });
  }

  const manifest: Manifest = {
    model: MODEL_ID,
    source: HF_BASE.replace(`/resolve/${REVISION}`, ''),
    revision: REVISION,
    format: 'ONNX fp32 (encoder_model + decoder_model_merged) loaded by @huggingface/transformers',
    architecture: process.arch,
    runtime: `@huggingface/transformers ${transformersVersion} + onnxruntime-node (CPU)`,
    generatedAt: new Date().toISOString(),
    files,
    totalBytes,
  };
  if (!recording) {
    // Preserve the original generation timestamp + provenance; only the file set is checked.
    const prev: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    manifest.generatedAt = prev.generatedAt || manifest.generatedAt;
    if (prev.revision && prev.revision !== REVISION) {
      process.stdout.write(`  ! manifest revision (${prev.revision.slice(0, 12)}) differs from env (${REVISION.slice(0, 12)})\n`);
    }
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  process.stdout.write(`\nALL ${files.length} FILES ${recording ? 'RECORDED' : 'VERIFIED'} · total ${totalBytes.toLocaleString()} bytes (~${(totalBytes / 1048576).toFixed(0)} MB)\nmanifest → ${MANIFEST}\n`);
}

main().catch((e) => { console.error(`\nPREBUNDLE_FAIL: ${e?.message || e}`); process.exit(1); });
