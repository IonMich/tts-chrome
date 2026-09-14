# Kokoro GPU repair — 2.1.1 review candidate

The original Nicole freeze was reproduced and traced to buffer churn in ONNX
Runtime's 2025 development GPU implementation. Its GPU process reached about
8 GiB and macOS entered critical memory pressure. Speech was already buffered
at “because”; the worker was generating a later chunk ahead of playback.
[Diagnosis and controlled comparisons](FINDINGS.md).

Version 2.1.1 replaces that runtime with the released ONNX Runtime Web 1.26.0
native WebGPU implementation. It retains the original full-precision model,
Nicole voice, article segmentation and reader controls. The intermediate custom
submission patch and the rejected half-precision experiment are not included.
The half-precision test was never installed and was rejected after voice-quality
review; the technical disposition is recorded in [FINDINGS.md](FINDINGS.md).

## Verified

- All 32 regression tests, TypeScript and the production build pass.
- Every packaged model, voice and matching runtime asset passes its pinned hash.
- The actual packaged GPU worker generated 160.45 seconds in 14 chunks during a
  three-minute run, with no audio underruns or long tasks. First rendered sound
  was 3.686 seconds. GPU physical footprint peaked at 1,846 MiB; macOS memory
  pressure stayed normal (1), and GPU footprint fell to 465 MiB after cleanup.
- Pause released voice memory after 30 seconds; resume after 35 seconds reloaded
  it and continued. Backward seek, 1.25× playback and return to 1× were exercised.
- Visible local 1080p60 test-video intervals presented about 59–60 fps during
  synthesis. The last four chunks lacked a full visible interval after the tab
  became hidden and are excluded from the video claim.
- A short simulated-unavailable-GPU test took the normal CPU fallback, generated
  the reported phrase and reached natural completion. This does not establish
  long CPU playback continuity.

The portable diagnosis and review are retained in this directory. Raw run JSON,
generated benchmark summaries, build logs and machine-local integration receipts
remain local and are intentionally excluded from product commits.

## Activation and remaining review

This is a tested review candidate, not owner acceptance of the separate live
video or voice quality. The ordinary-page harness uses the real engine and
packaged worker; it does not activate the installed extension. The local test
video's counters do not measure the owner's separate video tab.

The unpacked build belongs at `tts-ext/.output/chrome-mv3`. Machine-local
integration receipts and rollback backups are not tracked. Chrome reload remains
manual; no alternate browser profile or extension-management workaround was used.

After integration, reload the existing Local Reader entry on Chrome's extensions
page, confirm 2.1.1, and refresh the article. Select Nicole and read through the
reported phrase while the usual separate video plays. Voice quality and that
video's smoothness still need the owner's confirmation. The Mac Start Speaking
route's separate article review is unchanged; PL-14 and the prior D66 rejection
are not marked accepted by these measurements.

## Rollback

Use the machine-local integration receipt and its preserved build backup. Restore
only after checking that no later local build changes would be lost, then reload
the extension and refresh the article manually. The native Mac helper is unchanged
by this runtime update and has its own separate rollback procedure.
