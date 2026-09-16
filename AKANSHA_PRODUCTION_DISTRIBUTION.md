# AKANSHA — Production Distribution & First-Run (Design Only)

**STATUS: DESIGN.** Nothing in this file is claimed as built or verified. The
offline code foundations that DO exist and are tested are listed in
`CONTEXT_HANDOFF.md` / `GRAPHIFY.md`. Everything below is the intended next layer
and is **NOT IMPLEMENTED** or **BLOCKED** until built and actually tested on the
target platform. `NO EVIDENCE = NO SUCCESS`.

## What is already IMPLEMENTED + TESTED offline (this pass)
- Signed model catalog contract (`src/core/catalog/ModelCatalog.ts`).
- Compatibility engine, MODEL×HARDWARE×RUNTIME, honest Measured/Estimated labels
  (`src/core/catalog/CompatibilityEngine.ts`).
- RuntimeManager (runtime≠model) + ModelManager secure-install pipeline, `usable`
  gated on real inference (`src/core/runtime/RuntimeManager.ts`,
  `src/core/catalog/ModelManager.ts`).
- Signed release/update manifest verification (HTTPS+Ed25519+SHA-256+platform+arch+
  version) (`src/core/update/ReleaseManifest.ts`).
- Connected-services identity separation + OpenRouter PKCE OAuth start/parse/complete
  (`src/core/identity/ConnectedServices.ts`, `src/integrations/openrouter/oauth.ts`).
- Offline/Online/**Both**/auto AI-mode (`src/core/models/AiMode.ts`).
Tests: 97/97; tsc clean; next build ok.

## First-run wizard (UI) — NOT IMPLEMENTED (design)
Steps (Welcome → Create/sign-in → Choose AI (Offline/Online/Both) → Configure →
Install/Authorize → Verify → Ready) belong in the Next.js App Router UI
(`src/app/`, `src/ui/workspaces/`). The UI must consume the signed catalog via the
server (never hard-code models). Needs building + a running Electron/Next session to
verify visually — not done here.

## Per-platform installers + signing — BLOCKED
- Windows x64/ARM64, macOS Apple Silicon/Intel, Linux x64/ARM64, Android (APK/AAB),
  iOS. electron-builder.yml currently targets Windows NSIS/portable. The other
  targets need CI matrix jobs + real signing identities.
- **Code signing / notarization requires purchased certs + notary credentials that
  are NOT present.** Without them, signing is a CI configuration requirement,
  explicitly NOT implemented — do not use fake certificates.

## Runtime/model download & live inference — BLOCKED
- The pipeline verifies integrity and refuses `usable` without a real inference
  pass, but there is still **no llama.cpp/Ollama runtime on this machine** and no
  signed manifest public key + no downloaded artifact wired into the real project.
  Live local inference remains BLOCKED until a runtime + a signed artifact exist.
  No multi-GB model is downloaded during this architecture task.

## Cross-device sync / accounts — NOT IMPLEMENTED (design)
- Akansha identity (Google / email OTP / secure session) is separate from OpenRouter
  (a connected service) — the credential model exists (`ConnectedServices`) but the
  hosted identity provider + sync service (prefs, model-selection metadata, device
  registry, connectors, cloud config) is a backend service that does not exist yet.
- Local model FILES never sync; each device installs its own.

## Update service — verification logic IMPLEMENTED, delivery NOT
- `ReleaseManifest.verifyRelease` gates HTTPS+signature+sha256+platform+arch+version.
  The release pipeline that produces signed manifests, the CDN/GitHub Releases, and
  the client updater wiring are NOT built.

## CI/CD (GitHub Actions) — NOT IMPLEMENTED
- Intended: commit → lint → unit → integration → tsc → security scan → build →
  package (Win x64/ARM64, macOS arm64/intel, Linux x64/arm64, Android, iOS) →
  sign → sha256 → release-manifest → publish → update service.
- Not created (no repo remote configured; no signing secrets). This repo currently
  has NO git remote and commits stay local.

## Security invariants (preserve in all future work)
One orchestrator · one ModelRouter · one TTS authority · one provisioning path ·
signed manifests + SHA-256 + secure credential storage (opaque refs, never raw) ·
permission gates · no hidden cloud fallback · no unsigned model/binary execution ·
never log or commit keys/secrets. `Desktop/Akansha-source` stays read-only.
