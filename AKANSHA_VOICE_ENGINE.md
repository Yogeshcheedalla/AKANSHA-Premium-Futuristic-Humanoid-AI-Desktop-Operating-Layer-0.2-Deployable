# AKANSHA — Voice / Audio Engine (Feature 3)

## Model

The previous voice layer was a server-side **state machine with no audio I/O**. Akansha now has a real client-side audio engine that uses the actual browser microphone and speakers, while the server-side `VoicePipeline` remains the authoritative decision brain (ownership, wake-word, single-speech logic). No mocks, no simulated audio.

```
MICROPHONE → getUserMedia → AudioContext + AnalyserNode (local VAD/RMS)
  → SpeechRecognition (Web Speech API): partial → UI only, final → pipeline
  → intent → MASTER ORCHESTRATOR → response
  → speechSynthesis (ONE authoritative path, female voice) → AUDIO OUTPUT
  → barge-in: user speech while speaking cancels output instantly
```

## Files added

- `src/ui/voice/AudioEngine.ts` — the real transport:
  - `capabilities()` → honest `{ mic, asr, tts }` feature detection (never claims readiness without the API).
  - `start()` → `getUserMedia` (echoCancellation + noiseSuppression) + `AudioContext` + `AnalyserNode` RMS VAD loop.
  - `startListening()` → `SpeechRecognition` (continuous, interim). **Partial → `onPartial` (UI only). Final → `onFinalUtterance` with a unique `utteranceId` (executable).**
  - `speak(responseId, text)` → single authority: duplicate `responseId` suppressed; `speechSynthesis` with a chosen female voice; states SPEAKING→STANDBY.
  - `bargeIn()` → cancels output the instant the user speaks/types while speaking.
  - `setMuted()`, `stopListening()`, `dispose()` (stops tracks, closes context).
  - Explicit states: `MUTED/STANDBY/LISTENING/PROCESSING/SPEAKING/INTERRUPTED/ERROR` with an allowed-transition table.
  - Error taxonomy: `MICROPHONE_UNAVAILABLE`, `MICROPHONE_PERMISSION_DENIED`, `ASR_UNAVAILABLE`, `ASR_TIMEOUT`, `TTS_UNAVAILABLE`, `PLAYBACK_ERROR`, `DEVICE_BUSY`, etc.
  - Pure decision logic (`isExecutable`, `shouldSpeak`, `decideBargeIn`, `decideVad`, `canTransition`) is side-effect-free and unit-testable without hardware.

## Files changed

- `src/ui/workspaces/CommandWorkspace.tsx` — the mic button now drives the real engine (start capture + listening; stop on toggle); final utterances route into the same `send()` pipeline; assistant responses are spoken through the single `audioEngine.speak()`; typing while speaking triggers barge-in; the UI shows the **real** voice state and “ASR unavailable” when the API is missing; a login overlay handles the auth-gated command route. No component calls `speechSynthesis` directly — `AudioEngine` is the only TTS path.

## Voice flow

Mic → VAD (LISTENING) → SpeechRecognition → partial shown in the input placeholder (never executed) → final transcript + `utteranceId` → `POST /api/akansha/command` → response → `audioEngine.speak()` (deduped) → TTS. Barge-in cancels TTS and returns to LISTENING.

## Permissions / privacy

- Always-on = local standby + VAD + wake/ownership gating only; no continuous cloud audio upload; raw audio is not retained (stream tracks are stopped on `dispose`/mute).
- Microphone state is visible in the UI; mute is a hard switch.
- Speaker verification (server-side) assists identity but is never sole authorization for sensitive actions (server auth is separate — see AKANSHA_AUTH_SECURITY.md).

## Tests (added, hardware-free)

`src/core/audit2.test.ts`: partial ASR never executable / final is; one `responseId` speaks at most once; barge-in only cancels while speaking; VAD standby→listening only when speaking (and never barges via VAD alone); state machine rejects illegal transitions.

## Actual runtime results

- `tsc --noEmit`, `next build`, and `npm test` (32 tests) all **PASS**; the voice module compiles into the client bundle and the pure logic is unit-verified.
- The engine genuinely calls `getUserMedia` / `SpeechRecognition` / `speechSynthesis` — these are real Web APIs, not stubs.

## UNVERIFIED — ENVIRONMENT LIMITATION

- **Microphone capture, live ASR, and audible TTS could NOT be exercised here**: this is a headless automation environment with no interactive browser and no audio input/output device. They are implemented for real and will function in a browser/Electron session that grants mic permission and provides a speech-synthesis voice, but I have not personally observed audio in this environment.
- Web Speech `SpeechRecognition` availability varies by browser (Chromium supports it; some browsers do not) — the engine reports `asr: false` honestly rather than pretending.
- Local/offline ASR (Whisper) and cloud ASR providers are **not** wired; only the browser Web Speech API is used. A pluggable `ASRProvider` (Local/Cloud) is the next step.
- Streaming TTS and true acoustic barge-in detection during playback (as opposed to keystroke/typing barge-in) are not implemented.

## Recommended next steps

1. Add a pluggable `ASRProvider` (local Whisper / cloud) behind the same final-utterance gate.
2. Add a TTS provider abstraction (browser `speechSynthesis` now; ElevenLabs/local TTS later) still routed through the single authority.
3. Implement acoustic barge-in using the VAD stream while `state === 'SPEAKING'`.
4. Verify end-to-end in a real browser session with a microphone (grant permission, speak “open Notepad”, observe transcript → execution → spoken response).
