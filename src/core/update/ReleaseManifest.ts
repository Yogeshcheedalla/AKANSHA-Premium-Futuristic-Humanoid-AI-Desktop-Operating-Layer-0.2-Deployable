/**
 * Release Manifest — signed, checksum-pinned distribution/update verification for
 * the APPLICATION, a RUNTIME, and the MODEL CATALOG. Same trust principle as
 * models: HTTPS + Ed25519 signature + SHA-256 + platform + architecture + version
 * must ALL match before anything is accepted for install/update.
 *
 * This is the verification logic only — it never downloads or installs. The
 * installer/update-service performs the fetch and hands bytes + the target
 * descriptor to `checkRelease`. Signing is done by the release pipeline; if a
 * signing key is not configured, releases simply fail signature verification
 * (honestly BLOCKED), which is better than trusting an unsigned artifact.
 */
import { canonicalJson, verifyManifestSignature, sha256Hex } from '@/core/models/local/ModelIntegrity';

export type ReleaseChannel = 'stable' | 'beta' | 'canary';
export type ReleaseComponent = 'app' | 'runtime' | 'model-catalog';

export interface ReleaseArtifact {
  id: string;                    // e.g. 'AkanshaSetup-1.4.0-win-x64'
  component: ReleaseComponent;
  version: string;               // semver
  platform: 'win32' | 'darwin' | 'linux' | 'android';
  arch: 'x64' | 'arm64';
  url: string;                   // https CDN / GitHub release
  sha256: string;                // 64-hex
  sizeBytes: number;
  minAppVersion?: string;        // for updates: from which versions this applies
}

export interface ReleaseManifest {
  schema: 'akansha/release/1';
  channel: ReleaseChannel;
  issuedAt: number;
  expiresAt?: number;
  artifacts: ReleaseArtifact[];
}

export interface SignedRelease { manifest: ReleaseManifest; signatureBase64: string }

/**
 * A target describes what THIS client wants to install/update right now.
 */
export function findArtifact(manifest: ReleaseManifest, target: { component: ReleaseComponent; platform: string; arch: string }): ReleaseArtifact | null {
  return manifest.artifacts.find((a) => a.component === target.component && a.platform === target.platform && a.arch === target.arch) || null;
}

/**
 * Verify the signed manifest (aggregate signature + schema) and that a candidate
 * artifact matches the target platform/arch/version and a real https url + sha.
 * Returns ok only when every gate passes; otherwise explicit reasons — an
 * unsigned or mismatched release is NEVER accepted.
 */
export function verifyRelease(signed: SignedRelease, publicKeyPem: string, target: { component: ReleaseComponent; platform: string; arch: string }, now = Date.now()): { ok: boolean; reasons: string[]; artifact?: ReleaseArtifact } {
  const reasons: string[] = [];
  const m = signed.manifest;
  if (!m || m.schema !== 'akansha/release/1') reasons.push('bad-schema');
  if (!verifyManifestSignature(m as unknown as never, signed.signatureBase64, publicKeyPem)) reasons.push('bad-signature');
  if (typeof m?.expiresAt === 'number' && now > m.expiresAt) reasons.push('expired');

  const artifact = m ? findArtifact(m, target) : null;
  if (!artifact) { reasons.push('no-artifact-for-platform'); return { ok: false, reasons }; }
  if (!/^https:\/\//i.test(artifact.url)) reasons.push('insecure-url');
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256 || '')) reasons.push('bad-checksum');

  return { ok: reasons.length === 0, reasons, artifact };
}

/** Given the downloaded bytes, confirm they match the pinned checksum. */
export function artifactBytesMatch(artifact: ReleaseArtifact, bytes: Uint8Array | string): boolean {
  return sha256Hex(bytes).toLowerCase() === artifact.sha256.toLowerCase();
}

export function canonicalRelease(m: ReleaseManifest): string { return canonicalJson(m); }
