# Local Reader extension

[Product overview](../README.md) · [Verification history](../docs/verification.md) · [Mac helper](../native/mac/README.md)

The extension has one background-owned reading session. Kokoro uses an offscreen audio controller and disposable inference worker. The optional Mac voice sends extracted text to an on-demand native helper without creating browser audio or an inference worker. The page and popup provide synchronized playback controls. The popup also launches readings and saves settings.

Select the current voice's portrait or name in either player to change voices. Changes apply to the current reading and save the preference for future readings. Kokoro continues from the start of the current sentence; paused readings stay paused until Play. Switching away from Mac Start Speaking restarts the passage because that interface provides no speech position. Changing a completed reading prepares it from the beginning and waits for Play.

Version **2.1.2** adds source-page sentence highlighting driven by Kokoro media time and keeps Mac Start, Stop and replay state consistent across the popup and page player. It retains version 2.1.1’s ONNX Runtime Web 1.26.0 native WebGPU path, original full-precision model and voices; see the [measured diagnosis](../docs/evidence/kokoro-freeze/REVIEW.md). The Mac route preserves the accepted system voice but has no demonstrated pause, speed, time seek or speech-position API; follow the remaining parity work in [GitHub issue #1](https://github.com/IonMich/tts-chrome/issues/1).

After building this update, **Reload Local Reader** on Chrome’s extensions page, verify version **2.1.2**, then **refresh the article tab** to discard its older injected controller. Existing Chrome shortcut assignments remain unchanged; use the popup buttons if another extension currently owns a shortcut.

See [installation and everyday usage](../README.md). The extension is Chrome Manifest V3, with a declared minimum Chrome version of 116. The acceptance run uses Chrome 148; Firefox and other browser builds are not established by that run.

## Build and inspect

```sh
npm ci
npm run prepare:assets
npm run compile
npm run build
node --test tests/reader-regressions.test.mjs
```

Use Node.js 22 or later for this checked toolchain. Load `.output/chrome-mv3` as an unpacked extension only after the asset checks and build pass. A JavaScript-only build without the model, tokenizer, voices and WASM assets is not a complete installation.

`prepare:assets` handles the hash-verified local asset set. Those assets belong to the installation, not to each reading request. The packaged content-security policy permits same-extension connections; the final acceptance report records actual observed requests and any limits of the offline test.

## Session flow

1. A context-menu command, configured keyboard shortcut or popup button requests a specific text or page.
2. The background owner stops the previous session, records the owning tab and injects the page controller under `activeTab`.
3. Only the explicit `reader:show` command creates the player. There is no automatically registered all-page content script.
4. The offscreen controller creates the audio context and inference worker. Speech chunks target 160 characters, with up to 64 extra characters to finish a nearby sentence or clause (224 maximum). Paragraph boundaries and source offsets are preserved. The separate 512-token guard splits oversized input before generation; numeric-heavy passages must not silently truncate.
5. Generated chunks are scheduled ahead of playback. The UI receives real state, timing and buffering information from the single session.
6. Stop, completion, long pause and tab lifecycle events release the appropriate resources. Session identifiers and cancellation guards reject stale worker messages.

WebGPU with the full-precision Kokoro model is the preferred route after measured CPU/GPU comparisons. This can involve mixed kernel execution; it is not a claim that every model operation runs on the GPU. The fallback uses the same fp32 model through up to four WASM threads; no second model is downloaded. The longer Nicole CPU comparison avoided critical memory pressure but developed audio underruns; CPU remains an availability fallback. The installed WebGPU route passed a 130.45-second / 11-chunk run with zero recorded scheduling underruns on Apple M2 / Chrome 148, at 4.104 seconds to first rendered non-silent output from engine start. See the root usage notes for the timing origin, offline-test coverage and remaining bounds. A smaller model file did not by itself establish faster or uninterrupted speech.

The build uses the released ONNX Runtime Web 1.26.0 native WebGPU entry point without a local runtime scheduling patch. That runtime upgrade retained model weights, voice data, chunking, inference precision and speech speed. Worker-owned tensor wrappers are disposed after extracting the CPU waveform; that cleanup alone did not explain the earlier GPU peak.

## Source map

| Area | Entry point |
|---|---|
| Session ownership, explicit invocation and tab cleanup | `src/entrypoints/background.ts` |
| Offscreen document and audio scheduling | `src/entrypoints/offscreen/` and `src/lib/readerEngine.ts` |
| Local model inference and tokenizer guard | `src/entrypoints/speech-worker.ts` |
| Shared requests, state and lightweight UI client | `src/lib/readerProtocol.ts`, `src/lib/readerClient.ts` |
| Explicit shadow-root player mount | `src/entrypoints/main.content.tsx` |
| Compact player appearance and controls | `src/components/reader/` |
| Popup commands and settings | `src/entrypoints/popup/App.tsx` |

## Verification boundaries

The preserved regression suite exercises segmentation coverage, numeric/token limits, the long-first-clip startup case, cancellation, stale responses, pause release and background recovery. Simulated browser/audio timing in a regression test is not a speech-performance measurement.

The [README screenshots](../README.md#read-where-you-are) use the production React popup and player with fixed example settings and playback state. They illustrate layout and controls without generating audio. See [screenshot sources and reproduction](../docs/assets/README.md). Installed-browser tests separately establish invocation permissions, first rendered non-silent output, scheduled playback gaps, offline requests and cleanup. The measured audible-start estimate includes the browser's reported output latency; it is not a microphone loopback measurement.

The existing Python/WebSocket code and older `ttsClient`/`modelLoader` files are retained history, not the active entry-point path. Their earlier cancellation, cache and performance behavior must not be attributed to this implementation.

## Current playback controls

`ReaderEngine` synthesizes at 1×; `NativeAudioStream` encodes incoming PCM to Opus and appends WebM to MediaSource through Mediabunny 1.56.0. A native audio element provides pitch-preserving live speed and source-time seeking. All controls pass through the existing background owner/session; no extra host permissions or server is introduced.

The buffer retains up to 10 minutes of past audio relative to the current position, plus bounded generated read-ahead and the in-flight clip. This bounds the retained time window, not total browser memory. Read-ahead targets 22 wall-clock seconds, adjusted for playback speed, with at most the currently generated clip beyond that threshold. Seek is clamped to the actual retained range. On completion the inference worker terminates; encoded replay is kept for 120 seconds with a visible expiry, then audio/offscreen resources close. Pause still unloads inference after 30 seconds; Close clears everything immediately. The original lifecycle/segmentation regression cases remain, adapted to the native stream controller, with new speed/range and finite completed-replay inactivity checks. Seeking or pausing completed replay rearms its finite deadline; Resume clears the deadline only while playback is active.

Historical playback-control measurements and their limits are summarized in the portable [verification history](../docs/verification.md).
