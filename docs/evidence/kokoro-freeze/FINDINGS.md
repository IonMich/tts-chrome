# Nicole GPU memory-pressure diagnosis

The owner reports a repeatable cursor freeze just before “because” in “because I
believe it could”, using `af_nicole` on *We Must Pace the Frontier*. The audio is
already prepared at that point; the worker is generating a later chunk ahead of
playback. The repeated burst occurs during chunk 4: 139 characters, 14.294 seconds
of generated speech. It is not necessary to change that phrase, voice or article.

## Reproduction and causal intervention

Tests used the actual reader engine and installed fp32 Kokoro worker/model in an
ordinary localhost page in the owner's Chrome 153.0.8010.36 on Apple M2. This is a
real browser/inference/audio test, not an installed-extension activation test.
Other user tabs remain open, so aggregate Chrome memory includes unrelated work.
The same extraction, 217 segments, Nicole voice and synthesis speed 1× were used.

- Original GPU: 8,145 MiB GPU-process physical-footprint peak about 11 seconds after
  first sound, critical macOS pressure (4), 451 ms maximum animation-frame gap.
- Instrumented original: 8,058 MiB, pressure 4, same generation stage. The buffer
  API's live count peaked near 2 GiB and fell after `destroy()`, undercounting
  backing allocations that the GPU still needed for queued work.
- An added 256 MiB buffer bucket did not help: 8,511 MiB, pressure 4. No such large
  buffers were allocated. This disproved the initial 160 MiB cutoff hypothesis.
- The allocator log instead showed **218 creations / 216 destructions of
  44,236,800-byte buffers** (42.1875 MiB), almost all during chunk 4. This bucket's
  freelist cap is only 2, versus 22 for the adjacent 32 MiB bucket.
- Changing only that cap from 2 to 22 yielded **18 creations / zero destructions**,
  2,547 MiB GPU peak, pressure 1, no long tasks or underruns. Same voice, model,
  text, shader count and generated audio lengths.
- Changing only GPU submission frequency from 16 dispatches to 1 yielded
  **1,747 MiB GPU peak**, pressure 1, no long tasks or underruns, first sound at
  3.426 seconds. This avoids enlarging the cache and was the first memory-safe candidate.

The two independent interventions support buffer churn and deferred GPU resource
release as the cause of the reproduced system-pressure event. Shader compilation
was a competing hypothesis, but changing buffer reuse/submission alone removed
the burst with the same shader pipeline count. This does not constitute a trace
of every internal Metal/Dawn allocation or an instrumented physical-pointer test.

## Why submission frequency matters

Installed ONNX Runtime is `1.22.0-dev.20250409-89f8206ba4` (Transformers 3.5.1,
kokoro-js 1.2.1). Its `gpu-data-manager.ts` places freed tensors in a pending list.
`backend-webgpu.ts` submits GPU commands and then calls `refreshPendingBuffers()`.
That routine returns buffers to the bucket freelist or calls `GPUBuffer.destroy()`
when its cap is exceeded. Destruction does not make memory immediately reusable
while earlier GPU commands still reference it. Batches of 16 can overflow a
two-buffer freelist repeatedly; the later allocations accumulate behind queued
GPU work. Submitting each dispatch lets the existing buffers be reused sooner.

That first candidate used a build-time, SHA-256-guarded change of exactly the
dispatch threshold. It did not satisfy the subsequent concurrent-video check.
The patch is retained as diagnostic evidence in `harness/ort122-submit-patch.ts`;
it is no longer part of the extension build. The replacement candidate uses the
released 1.26.0 runtime without a runtime source patch, as described below.

## Alternatives and limitations

The first 45-second fp32 WASM comparison had no pressure event or underruns and
started at 12.121 seconds. A three-minute CPU candidate later developed five
underruns, including a 30.638-second gap. Its pressure stayed normal. These are
preserved results, not a successful long CPU playback claim. The CPU-default
candidate was withdrawn; production retains GPU execution and CPU availability
fallback.

Tensor-wrapper disposal and removal of a redundant PCM copy are included as
lifecycle cleanup. Current outputs are CPU arrays; this cleanup is not the
explanation for the acute multi-gigabyte GPU burst.

All run JSON files, including unsuccessful experiments, are retained in `runs/`.
`comparison.json` is rebuilt by `node summarize-runs.mjs`. The sampler includes
per-process RSS and physical footprint every ~100 ms plus system pressure and
swap every ~500 ms. RSS alone hides this event because macOS compresses memory.
Timestamps share a Unix epoch; first sound is the AudioWorklet's first non-silent
rendered sample, not microphone loopback or the first toolbar click. The bounded
tests do not prove all articles, voices, machine loads or speeds.

Upstream context: the [runtime buffer allocator](https://github.com/microsoft/onnxruntime/blob/89f8206ba4/js/web/lib/wasm/jsep/webgpu/gpu-data-manager.ts)
shows the pool policy, and [ONNX Runtime issue 29016](https://github.com/microsoft/onnxruntime/issues/29016)
reports allocation differences from cache reuse in another workload. That issue
is supporting context; the local controlled interventions establish this result.

## Concurrent video remains a separate acceptance failure

The owner repeatedly reported unrelated video falling below 10 fps during GPU
synthesis, including the submission-only, 1 ms pacing and 80-character segment
experiments. The cursor no longer froze. These failures remain open. A local
1080p60 H.264 test video quantifies contention but is not the same video: without
synthesis it presented about 59 fps; during the long fp32 chunks it averaged
47–52 fps with up to 22% dropped frames. One-millisecond worker pauses improved
that only modestly. Smaller segments helped the local test video but did not
satisfy the owner’s separate playback observation.

Hardware AGX counters in `gpu-util-1789331191766.json` reached 97–100% during
generation, dropping to about 7% afterward. Memory pressure was already normal.
This supports GPU saturation as an additional problem after the allocation burst
is corrected; it does not identify a particular shader or scheduler defect, and
the registry sample does not attribute each GPU cycle to a process.

A diagnostic attempt to wrap the pinned WASM glue’s synchronous JSEP kernel call
in Asyncify and await queue completion did not produce any audio within the
bounded test. It was stopped and is not a valid production patch. This experiment
used one short phrase, not the article. No production WASM asset was altered.

The official half-precision model was also tested in isolation and rejected in
owner listening as unintelligible, regardless of its performance measurements.
It was never installed. The original fp32 model and all original voice hashes
remain unchanged.

## Released native WebGPU runtime candidate

An isolated comparison replaced only the old inference runtime with the released
ONNX Runtime Web 1.26.0 native WebGPU implementation. The original fp32 model,
Nicole voice, article, segmentation and playback engine were retained. Its
matching Asyncify JS/WASM assets were used together; the earlier JSEP binaries
and custom dispatch patch were not used.

`gpu-ort126-1789332092845.json` produced six chunks, including the reported phrase
and original pressure-triggering chunk. The local 1080p60 test video presented
59.4–60.0 fps during synthesis (59.7 fps idle), with at most 0.56% dropped frames
per chunk. GPU physical footprint peaked at 1,616 MiB, pressure stayed normal (1),
and there were no audio underruns or frame gaps above 17.7 ms. First rendered
sound was at 6.094 seconds. This isolates a runtime replacement, not an individual
kernel or scheduling change; no claim is made that one upstream commit alone
explains the video improvement.

The worktree build now pins `onnxruntime-web` and its browser Tensor API to
1.26.0, selects the `onnxruntime-web/webgpu` entry point, and packages the matching
Asyncify assets with verified hashes. The model and nine voice-file hashes are
unchanged. The released runtime requires no local scheduling, precision or cache
patch. `runtime-build-check.json` records the build and asset checks.

This local video's measurements do not establish the owner's separate live
video performance or subjective voice acceptance. That feedback is pending.
The [official release](https://github.com/microsoft/onnxruntime/releases/tag/v1.26.0)
and installed source document the runtime version; the local traces establish
the measured comparison.

The actual production build was then tested for three minutes in
`gpu-release126-1789332478412.json`: 14 chunks / 160.448 seconds generated,
first sound 3.686 seconds, zero underruns, zero long tasks, 1,846 MiB GPU peak,
normal pressure throughout. Pause released the worker, and resume after a
35-second pause reloaded it and continued; backward seeking and speed changes
were exercised. Visible video intervals remained about 59–60 fps, but the last
four chunks had no full visible interval and are excluded from that claim.
The short `wasm-release126-1789332725342.json` run simulated an unavailable GPU,
observed the real CPU fallback and natural completion of the reported phrase.
