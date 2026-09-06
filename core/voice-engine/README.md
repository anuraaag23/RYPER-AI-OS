# @ryper/voice-engine — Voice Engine & Audio Platform

Phase 6 of RYPER AI OS. The single voice platform for Desktop, Android,
iPhone, iPad, and future wearables — wake word through to speaker output,
built on the already-approved Core AI Engine, Memory System, and Local AI
Runtime rather than duplicating any of their functionality.

## Reuse — nothing here was reimplemented that already existed

- **Core AI Engine (`@ryper/ai-engine`)**: `AudioPipelineManager` calls
  `AIOrchestrator.sendMessage()` directly for conversational turns, and
  reuses `retryWithBackoff` for AI Engine call retries rather than writing
  a second retry mechanism. As of Phase 13.5, `platform/desktop-app`
  constructs a real `AIOrchestrator` too — not via `AudioPipelineManager`
  itself, which that shell doesn't use; see `docs/adr/0016` for why.
- **Memory System (`@ryper/memory-system`)**: `VoiceContextManager` is a
  thin bridge to `MemoryManager` — every voice turn is stored as a real
  `conversation`-type memory and retrieved via `MemoryManager.searchMemories()`.
- **Local AI Runtime (`@ryper/local-runtime`)**: the local STT/TTS
  providers (`stt/local.ts`, `tts/local.ts`) wrap
  `LocalRuntimeManager.transcribe()`/`.synthesizeSpeech()` — Phase 4
  already implemented these; this phase adapts them to the streaming
  `SpeechRecognitionProvider`/`SpeechSynthesisProvider` shape. `offlineStatus`
  reuses `@ryper/local-runtime`'s existing `OfflineStatusDetector`.
- **Cloud provider plumbing (`@ryper/ai-engine`)**: the cloud STT/TTS
  adapters reuse `HttpFetch`, `parseSSEStream`, and `assertOk` rather than
  writing a new HTTP/SSE layer.

No file in any of those packages was modified.

## Core modules → files

| Module                       | File                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Wake Word Engine             | `wake-word/engine.ts` (+ `wake-word/types.ts` for the pluggable provider contract) |
| Voice Session Manager        | `voice-session-manager.ts`                                                         |
| Audio Device Manager         | `audio-device-manager.ts`                                                          |
| Microphone Manager           | `microphone-manager.ts`                                                            |
| Speaker Manager              | `speaker-manager.ts`                                                               |
| Voice Activity Detection     | `voice-activity-detection.ts`                                                      |
| Noise Suppression            | `noise-suppression.ts`                                                             |
| Echo Cancellation            | `echo-cancellation.ts`                                                             |
| Streaming Speech Recognition | `stt/` (`types.ts`, `local.ts`, `cloud.ts`, `registry.ts`)                         |
| Streaming Text-to-Speech     | `tts/` (`types.ts`, `local.ts`, `cloud.ts`, `cache.ts`, `registry.ts`)             |
| Audio Pipeline Manager       | `audio-pipeline-manager.ts`                                                        |
| Voice Command Router         | `voice-command-router.ts` (+ `intent-detection.ts`)                                |
| Voice Context Manager        | `voice-context-manager.ts`                                                         |
| Voice Settings Manager       | `voice-settings.ts`                                                                |
| Voice Diagnostics            | `voice-diagnostics.ts`                                                             |
| Voice Analytics              | `voice-analytics.ts`                                                               |

## Honest limitations — read before wiring a real device

This package was built in a sandboxed Linux environment with no audio
hardware, no OS voice APIs, and no wake-word/STT/TTS model binaries to link
against. Every OS/hardware/model touchpoint is injected — the same pattern
`@ryper/ai-engine`'s `HttpFetch` and `@ryper/local-runtime`'s `OnnxSession`
already established — and is real, tested orchestration logic around that
injection point, not a placeholder:

- **`AudioDeviceSource`/`AudioCaptureSource`/`AudioPlaybackSink`**: a
  platform shell provides real bridges to WASAPI/CoreAudio/PulseAudio/
  AVAudioSession/AudioManager. Nothing in this package talks to hardware
  directly.
- **`WakeWordProvider`**: `EnergyWakeWordProvider` (`wake-word/local.ts`,
  Phase 13) is the first concrete implementation — a real, working,
  fully offline energy-envelope pulse-pattern detector, not a
  placeholder. It is honestly not a trained acoustic keyword-spotting
  model (Porcupine-style or similar); see its own doc comment for the
  precise capability/limitation boundary. `WakeWordEngine`'s
  sensitivity/cooldown/multi-provider logic around it is real and
  tested, and a production build can swap in a real trained detector
  behind the same `WakeWordProvider` interface with no change to any
  caller.
- **Noise Suppression / Echo Cancellation**: `BasicNoiseSuppressor` (DC
  offset + noise gate) and `NlmsEchoCanceller` (a real adaptive NLMS
  filter) are genuine, working DSP — not full spectral suppression
  (RNNoise-class). Both interfaces (`NoiseSuppressor`, `EchoCanceller`) are
  designed so a native/WASM library can be substituted with no caller
  changes.
- **Streaming STT/TTS depth**: `@ryper/local-runtime`'s `transcribe()`/
  `synthesizeSpeech()` are single-shot (Phase 4 didn't implement
  incremental local ASR/TTS), so `LocalSpeechRecognitionProvider`/
  `LocalSpeechSynthesisProvider` buffer-then-emit-once behind the
  streaming interface. The cloud adapters get genuine partial/incremental
  results (SSE for STT, raw byte streaming for TTS) since that's what the
  `HttpFetch` abstraction can express. All four satisfy the same
  `SpeechRecognitionProvider`/`SpeechSynthesisProvider` interfaces, so a
  future incremental local ASR/TTS backend drops in without touching the
  pipeline.

## Security

- The microphone is **never** captured outside an explicit
  `MicrophoneManager.startCapture()`/`stopCapture()` pair driven by
  `VoiceSessionManager`; there is no ambient "always recording" mode.
- `VoiceSessionManager` enforces a **hard `maxListeningMs` ceiling**
  (default 15s) — a session stuck in `listening` is force-cancelled, so a
  bug elsewhere can never leave the mic open indefinitely.
- `VoiceSettingsManager` exposes wake-word sensitivity and an
  enable/disable toggle as explicit, persisted user controls.
- Device permission checks (`AudioDeviceManager.hasPermission`/
  `requestPermission`) always go through the injected `AudioDeviceSource`
  — this package never bypasses the platform's own permission prompt.

## Performance

- `WakeWordEngine.processFrame` does no buffering/resampling of its own —
  it's O(providers) per frame with a cooldown check, keeping the always-on
  listening path cheap.
- VAD-based endpointing (`AudioPipelineManager`'s `endpointedFrames`) means
  the mic capture loop — and everything downstream — stops as soon as the
  user stops talking, rather than running for a fixed duration.
- `VoiceCache` avoids re-synthesizing repeated utterances (confirmations,
  common responses).
- `AIOrchestrator.sendMessage` streaming means the user hears the response
  begin as soon as text starts arriving from the model, not after the full
  reply completes (once a streaming-capable TTS backend is wired in).

## Integration: wiring a full pipeline

```ts
import {
  AudioDeviceManager,
  MicrophoneManager,
  SpeakerManager,
  EnergyVoiceActivityDetector,
  WakeWordEngine,
  SpeechRecognitionRegistry,
  createLocalSpeechRecognitionProvider,
  SpeechSynthesisRegistry,
  createLocalSpeechSynthesisProvider,
  IntentDetector,
  VoiceCommandRouter,
  notYetImplementedHandler,
  VoiceContextManager,
  VoiceSessionManager,
  VoiceSettingsManager,
  VoiceDiagnostics,
  VoiceAnalytics,
  AudioPipelineManager,
} from "@ryper/voice-engine";

const sttRegistry = new SpeechRecognitionRegistry();
sttRegistry.register(createLocalSpeechRecognitionProvider(localRuntimeManager, { device }));

const ttsRegistry = new SpeechSynthesisRegistry();
ttsRegistry.register(createLocalSpeechSynthesisProvider(localRuntimeManager, { device }, voices));

const commandRouter = new VoiceCommandRouter();
// Real handlers register normally; anything not built yet still answers honestly:
commandRouter.register(notYetImplementedHandler("edit_pdf", "PDF editing"));
commandRouter.register(notYetImplementedHandler("run_automation", "Automations"));

const pipeline = new AudioPipelineManager({
  sessionManager: new VoiceSessionManager(),
  microphoneManager: new MicrophoneManager(micDeviceManager, platformCaptureSource),
  speakerManager: new SpeakerManager(speakerDeviceManager, platformPlaybackSink),
  vad: new EnergyVoiceActivityDetector(),
  sttRegistry,
  ttsRegistry,
  intentDetector: new IntentDetector(),
  commandRouter,
  contextManager: new VoiceContextManager(memoryManager), // @ryper/memory-system, Phase 5
  orchestrator: aiOrchestrator, // @ryper/ai-engine, Phase 3
  settings: new VoiceSettingsManager(),
  diagnostics: new VoiceDiagnostics(),
  analytics: new VoiceAnalytics(telemetryClient), // opt-in only, infra/telemetry
});

// Wake Word Engine feeds an always-on low-power listening loop; on a hit,
// hand off to the pipeline for the full turn:
const wakeWordEngine = new WakeWordEngine([platformWakeWordProvider], eventBus);
// ... platform shell's low-power audio loop calls wakeWordEngine.processFrame(frame) ...
// on detection: await pipeline.runTurn(deviceState);
```

Future modules (Desktop Agent, Mobile Apps, Automation Engine) register
their own `VoiceCommandHandler`s with the same `VoiceCommandRouter` — no
change to `AudioPipelineManager` is needed as real command implementations
replace `notYetImplementedHandler` stubs one at a time.
