# Local Reader verification history

This page retains the useful engineering and measurement detail behind the product overview. The figures below describe bounded checks on named implementations, machines, passages, and clocks. They are evidence for those runs, not universal performance guarantees.

## Session and resource lifecycle

Local Reader has one background-owned reading session. An explicit command extracts text, records the owning tab, and mounts the player. Kokoro uses an offscreen audio controller and a disposable inference worker; the optional Mac path sends whole text to an on-demand native helper without creating browser audio or loading the bundled model.

Kokoro synthesizes PCM at 1×, encodes it to Opus/WebM, and appends it to a MediaSource-backed audio element. Browser playback rate provides pitch-preserving speed control. Read-ahead targets 22 wall-clock seconds at the selected speed, with at most the in-flight clip beyond that threshold. Seeking stays inside the generated range.

The encoded history retains up to ten minutes behind the current position, plus current and read-ahead audio. This bounds retained playback time, not total process memory. After synthesis finishes, the worker exits. After generated playback finishes, retained replay audio remains for two minutes before expiry closes the audio/offscreen runtime; pausing completed audio also starts that deadline. A pause longer than 30 seconds during generation releases inference while preserving enough audio to resume. Close clears the session immediately.

## Playback-control revision — 9 September 2026

A controlled extension run generated 93.26 seconds of audio while exercising 1.5× and 2× playback, pause, ±15-second movement, keyboard seek, long-pause model release, replay, and Close. First non-silent output was 6.488 seconds from the popup command handler; adding Chrome's reported output latency produced a 6.843-second estimate. No microphone loopback was used, and no generation-buffer underrun was recorded in that run.

A later pointer/replay check waited for more than ten seconds of generated audio, dragged from 4.20 to 10.7 seconds, and sought to three seconds after completion. Seeking or pausing completed audio rearmed the finite inactivity deadline. The offscreen runtime closed after 120.407 seconds and the seekable range became empty. A separate shortened-history test verified eviction of consumed audio, protection of current/paused audio, and clamping at the moving boundary; it did not measure the ten-minute policy under full load.

## Kokoro GPU repair — 13 September 2026

The original Nicole freeze was traced to buffer churn in a development ONNX Runtime WebGPU build. The production repair moved to released ONNX Runtime Web 1.26.0's native WebGPU entry point while retaining the original fp32 model, voices, segmentation, and player behavior.

In the documented three-minute production-code run, the engine generated 160.448 seconds across 14 chunks with no recorded scheduling underruns or long tasks. First rendered non-silent output was 3.686 seconds from engine start. GPU-process physical footprint peaked at 1,846 MiB and memory pressure stayed normal for that run. Pause/reload, backward seek, and speed changes were exercised. Visible intervals of the local 1080p60 test video remained near 59–60 fps, but later hidden intervals were excluded. These numbers do not describe every device or the owner's separate video tab.

A short simulated-WebGPU-unavailable check reached the WASM fallback and completed the target phrase. A longer earlier CPU run avoided critical memory pressure but developed audio underruns, so CPU remains an availability fallback rather than the selected performance path. See the [full causal findings](evidence/kokoro-freeze/FINDINGS.md) and [review boundaries](evidence/kokoro-freeze/REVIEW.md).

## Highlighting and native control evidence — version 2.1.2

The source-position contract keeps normalized UTF-16 offsets tied to the exact request text. Kokoro converts generated audio cues into media-time sentence positions, and the page maps those offsets back to DOM ranges without replacing article markup. Regression coverage includes pause, seek, replay, replacement, Stop, navigation, stale events, and replay expiry. The accepted combined suite passed 49 tests and TypeScript compilation before integration.

The macOS whole-text route exposes lifecycle state but no demonstrated audio clock or speech-boundary stream. Version 2.1.2 therefore reports native position as unavailable and offers Start, Stop, and replay rather than timer-based approximations. Remaining pause, seek, speed, progress, and boundary work is tracked in [issue #1](https://github.com/IonMich/tts-chrome/issues/1).

## Reproduce the silent checks

From `tts-ext/` with Node.js 22 or later:

```sh
npm ci
npm run prepare:assets
npm test
npm run compile
npm run build
```

The asset step validates the pinned model, voices, and runtime files before a build. Browser, audible, resource, and subjective listening results require separate explicit runs; unit tests and compilation do not substitute for them.

## Historical backend

`websocket-server.py`, `test_stream_sd.py`, and the Python dependency files belong to an earlier local-server experiment. They are not required by the current extension and do not inherit its browser lifecycle or verification claims.
