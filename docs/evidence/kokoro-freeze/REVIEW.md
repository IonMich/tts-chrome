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
The half-precision test was never installed; the owner's gibberish report remains
recorded as a rejection in owner-feedback.json.

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

Full evidence is retained in
/Users/ioannism/.codex/worktrees/fce4/tts-chrome/docs/evidence/kokoro-freeze:
comparison.json, video-comparison.json, runtime-build-check.json,
regression-tests.txt, typecheck.txt, build.txt, and the raw JSON files in runs/.

## Activation and remaining review

This is a tested review candidate, not owner acceptance of the separate live
video or voice quality. The ordinary-page harness uses the real engine and
packaged worker; it does not activate the installed extension. The local test
video's counters do not measure the owner's separate video tab.

The guarded integration-receipt.json in that worktree evidence folder records
whether 2.1.1 has been
copied to the existing unpacked folder:
/Users/ioannism/repos/tts-chrome/tts-ext/.output/chrome-mv3.
Chrome reload remains manual because the browser URL policy rejected extension
management; no alternate surface or profile workaround was used.

After integration, reload the existing Local Reader entry on Chrome's extensions
page, confirm 2.1.1, and refresh the article. Select Nicole and read through the
reported phrase while the usual separate video plays. Voice quality and that
video's smoothness still need the owner's confirmation. The Mac Start Speaking
route's separate article review is unchanged; PL-14 and the prior D66 rejection
are not marked accepted by these measurements.

## Rollback

Keep the integration receipt and the source/build backup it names. This guarded
command restores 2.1.0 only if no later edits or build changes would be lost:

```sh
node /Users/ioannism/.codex/worktrees/fce4/tts-chrome/docs/evidence/kokoro-freeze/integrate.mjs rollback
```

Then run npm ci in the live tts-ext directory to match the restored lockfile,
reload the extension and refresh the article manually. The native Mac helper is
unchanged by this update and has its own separate rollback procedure.
