# Local Reader

Read selected text or an article aloud in Chrome using Kokoro or the optional macOS Start Speaking helper. Speech runs locally without an account, API key or Python server.

Version **2.1.2** adds playback-synchronized Kokoro sentence highlighting on the source page and consistent Mac Start, Stop and replay state in the popup and page player. It retains version 2.1.1’s ONNX Runtime Web 1.26.0 native WebGPU path, original full-precision model and voices; see the [GPU diagnosis](docs/evidence/kokoro-freeze/REVIEW.md). The accepted Mac voice still has no demonstrated pause, speed, time seek or speech-position API; that remaining parity work is tracked in [GitHub issue #1](https://github.com/IonMich/tts-chrome/issues/1). Installation, Chrome reload and article acceptance are separate steps.

Nothing appears on visited pages until you ask it to read. An explicit request opens a compact charcoal player with pause/resume, inline pitch-preserving speed, ±15-second movement, an accessible seek bar, and Close. Voice and next-reading defaults remain in the extension menu.

## Install the checked build

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select the repository's `tts-ext/.output/chrome-mv3` directory. If using the supplied ZIP, extract it first and select the directory containing `manifest.json`.
3. Pin **Local Reader** if you want its menu beside the address bar.
4. Open an ordinary article page, select a short passage and choose **Read aloud** from its right-click menu. Alternatively, open the extension and click **Read selected text** or **Read this page**.

Use the completed build delivered with the test record; a source checkout alone may not contain the required binary assets. The extension targets Chrome 116 or later; historical checks used Chrome 148, and the Kokoro freeze investigation uses Chrome 153. Other browsers are not covered by those checks.

The model, nine English voices, tokenizer and inference runtime are installed with the extension. Reading does not require fetching those files again. The preferred path uses WebGPU with the full-precision model; some operations may execute through ONNX Runtime's fallback kernels. The CPU fallback uses the same fp32 weights through up to four WASM threads; it does not download a second model. The model file is 325,532,232 bytes. The inspected unpacked browser build is 354,767,516 bytes including voices and runtime; this is disk storage, not active memory.

## Use it

- **Selected passage:** select text and use the right-click **Read aloud** command, or the extension menu.
- **Current article:** choose **Read this page**. This uses the page's article/main region when available; for complex pages, selecting the exact passage is more predictable.
- **Pasted text:** expand **Or paste text to read** in the extension menu, enter the text and press **Read this text**. Merely pasting does not start playback.
- **Speed now:** the inline selector changes current playback immediately, from 0.5× to 2×, with native pitch preservation. The extension-menu fields set the next reading’s defaults.
- **Seek:** back/forward 15 seconds and the draggable/keyboard timeline stay within the generated, retained audio range. The final duration is shown only when synthesis finishes.
- **History:** keep up to 10 minutes behind the current playback position, plus current/read-ahead audio. Paused/current audio is never evicted just because new audio is generated. Earlier consumed audio is released; the visible left range edge moves.
- **Completion:** inference ends immediately; a small encoded replay buffer and suspended audio context remain for two minutes. The player displays the countdown. Expiry clears replay audio and closes the offscreen runtime. Close clears them immediately.
- **Pause:** keeps your position and buffered audio. After 30 seconds paused, the inference worker is released; resuming may briefly prepare more audio.
- **Close:** stops the current session and removes the player. It does not advance a hidden queue.

The default shortcuts are **Command+Shift+S** / **Ctrl+Shift+S** for selected text and **Command+Shift+P** / **Ctrl+Shift+P** for the current page. Chrome or another extension may already use them; inspect or change assignments at `chrome://extensions/shortcuts`.

Chrome's own settings pages and some PDF viewers cannot accept an injected player. Use an ordinary web page or paste the text into the extension menu. This upgrade does not include OCR or guarantee correct extraction from every website.

## Installed files are not an always-loaded model

The extension keeps the voice files on disk once. It creates its inference worker only for an explicit reading request. After all requested audio has been generated, the model worker can be released while prepared audio continues playing. Closing the reader ends the session; completing playback closes the audio/offscreen runtime. A prolonged pause also releases inference, while retaining the small amount of prepared audio needed to resume.

Worker and audio lifecycle checks are not a measurement of process RSS or GPU memory. Recorded first-output times and uninterrupted runs apply to the tested browser, hardware, passage and speed. CPU fallback or a heavily loaded device may not meet the same timing. The UI shows preparation or buffering when necessary; it does not invent a total duration before the final audio length is known.

## Measured result and limits

On an **Apple M2, macOS 26.6.2, Chrome for Testing 148.0.7778.96**, the installed WebGPU route generated and played **130.45 seconds of speech across 11 chunks, with zero recorded scheduling underruns**. First non-silent output rendered **4.104 seconds after the engine started**; adding Chrome’s reported output latency gives an **estimated 4.467 seconds**. This clock begins after offscreen initialization, not at the user’s first toolbar click, and no microphone loopback was recorded. Total chunk generation was 39.13 seconds.

A separate native toolbar check verified the complete page-invocation path, actual play/pause/resume, dismissal and a second invocation without broadening permissions. Completion and Close left no offscreen document; a long pause released inference and resumed successfully.

The browser-context offline check passed, but its network interception was not independently demonstrated to cover every worker target. Local immutable asset URLs and the packaged extension’s `connect-src 'self'` restriction enforce the intended local-only route. Earlier CPU fallback checks generated two clips: 6.025 seconds of audio in 3.874 seconds, then 12.825 seconds in 7.044 seconds. A later three-minute Nicole CPU run avoided critical memory pressure but developed audio underruns, so CPU execution is not the chosen freeze repair.

These are bounded checks on one machine, passage, voice and speed. They do not guarantee sub-30-second startup on every device, indefinite stall-free playback, quantified RAM savings or correct pronunciation of every input.

## Build from source

Use Node.js 22 or later for the checked development toolchain:

```sh
cd tts-ext
npm ci
npm run prepare:assets
npm run build
```

`prepare:assets` verifies the required model/voice/runtime files against their recorded hashes and obtains missing assets. Keep the resulting local files for future builds. `npm ci` installs development dependencies; neither command is part of ordinary installed reading. The unpacked output is `tts-ext/.output/chrome-mv3`.

Developer checks and architecture are described in [the extension notes](tts-ext/README.md). Third-party model, voice, tokenizer and runtime notices are included with the packaged build. Kokoro is pretrained third-party software; this project implements the reading interface, browser integration, scheduling and lifecycle.

## Earlier Python backend

`websocket-server.py`, `test_stream_sd.py` and the Python dependency files remain available for the earlier local-server experiment. They are not required by the current extension and were not rewritten or given the new browser lifecycle guarantees. The previously retained Python recordings are separate evidence, not measurements of the new extension.

## Playback-controls revision, 9 September 2026

The revised actual extension passed a 93.26-second generated-audio run, including live 1.5×/2× playback, pause, ±15-second movement, keyboard seek, long-pause model release, replay and Close. First non-silent output was 6.488 seconds from the popup command handler; the output-latency estimate was 6.843 seconds, not microphone loopback. No recorded generation-buffer underruns occurred in that controlled run. The final verification record distinguishes this run from any later small changes.

PCM is synthesized at 1× and streamed through Chrome’s WebCodecs Opus encoder/Mediabunny WebM muxer into a native MediaSource audio element. Native playbackRate/preservesPitch handles current speed. Read-ahead is measured in wall-clock seconds at that speed; reaching ungenerated audio shows Buffering instead of claiming silence is ready. The encoded history is bounded by playback position; browser-decoded memory is not a measured zero-allocation guarantee. No additional speech model is downloaded.

The final real-browser pointer/replay check waited until more than 10 seconds of generated audio existed, dragged from 4.20 to 10.7 seconds, then sought to 3 seconds after completion. Seeking or pausing completed audio keeps a finite replay-inactivity deadline. After 120.407 seconds, the offscreen process had closed and the seekable range was empty. Ten regression checks include this lifecycle. A separate native-stream test with a shortened three-second history window verified eviction of consumed audio, protection of current/paused audio and clamping at the moving boundary; the 93-second speech run alone does not test the ten-minute threshold. This is a temporal retention policy, not a measured total-memory cap.
