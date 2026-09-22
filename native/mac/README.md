# Local Reader Mac Start Speaking host

This optional macOS backend uses the dynamically checked AppKit `NSApplication`
`speakString:`, `stopSpeaking:`, and `isSpeaking` selectors used by Chromium's
Mac Start Speaking integration. The actual voice follows macOS and is deliberately
not identified as Nora or any other public voice identifier.

The Chrome native-messaging relay exists only while Chrome holds the connection.
It launches a hidden agent application through LaunchServices because AppKit speech
does not start from a directly spawned command-line process on this Mac. Relay and
agent communicate through private mode-0600 FIFOs. Connection EOF triggers bounded
stop/exit cleanup, but EOF alone is never reported as verified shutdown.
There is no daemon, login item, network listener, PCM capture, or downloaded model.

Protocol requests use an `action` field: `capabilities`, `listVoices`, `speak`,
`stop`, and `shutdown`, each with a bounded string `id`. Responses use a `type` field.
Capabilities advertise `protocolVersion: 2` and `shutdownAcknowledgement: 1`.
The extension requires this protocol; an older installed helper must be rebuilt
and reinstalled before using Mac voice again.

A stop request retains the current utterance until `isSpeaking` reports false.
For a request cancelled before speech was observed, it also waits through the
three-second startup observation window, issuing stop again while waiting. New
speech is rejected while another utterance is active or stopping. Shutdown has
a five-second stop deadline. The agent reports an internal stopped state, then
waits while the relay registers a kernel process-exit watch before permitting
agent exit. Only that exact process's exit event produces the public
`shutdown-complete` response with the matching ID, `stopped: true`, and
`processExited: true`. Request receipt, FIFO EOF, and the `/usr/bin/open` launcher
exiting do not qualify. A timeout or helper failure produces no successful
shutdown acknowledgement; the extension blocks replacement on uncertain state.

Before posting speech, the extension records ownership in `chrome.storage.local`.
The record survives extension reload and service-worker restart and is cleared
only after the matching helper's verified shutdown. Pending ownership writes,
speech acquisition, and shutdown are serialized so a late old write or callback
cannot clear a replacement's record. Normal completion retires the helper and
clears the record promptly; errors reading or writing ownership fail closed.

If the background worker is lost while ownership is recorded, this version
cannot recover the old native connection and deliberately blocks new readings.
Reloading or reinstalling is not proof of process exit and does not clear the
record. Recovery requires a maintainer to verify that the previous helper has
exited before repairing the ownership record; a macOS restart establishes that
pre-restart helper processes have exited. Do not clear the record merely to retry
speech. There is no automatic recovery or user-facing recovery control yet.

Speech yields `started` followed by exactly one `ended`,
`cancelled`, or `error`. The mode can stop but cannot pause, seek, return PCM, or
report the underlying macOS voice identifier.

Build the extension and native helper from `tts-ext` with `npm run build:mac`.
Run `npm run compile` and `npm test` for extension checks. The following native
regression command builds in `native/mac/.build`, tests injected speech states,
then launches the built helper for seven **silent** capability/shutdown, EOF,
and owned-helper failure checks; it never sends actual speech or installs it:

```sh
./native/mac/test-shutdown.sh
```

The injected-state tests cover delayed startup, delayed stop, rejected overlap,
wrong exit IDs, and timeout. Real-helper checks verify idle process exit and
protocol framing, not audible speech overlap or voice quality.

`npm run test:native` is an **audible**, opt-in combined engine/adapter/native-process check; it does
not reload Chrome or establish browser acceptance. `./test-install.sh` verifies
installer rollback in a temporary home directory.

Install for the existing production extension per-user,
without `sudo`:

```sh
./install.sh hmegielmjgbccfcigkejhpgjbeeedfpj
```

The host name is `com.localreader.native_tts`. The script registers only the exact
production extension origin and saves any pre-existing relay, agent, and manifest.
Rollback restores those files:

```sh
./uninstall.sh
```

Reload the existing Local Reader entry in Chrome's extensions page manually,
confirm **2.1.2**, and refresh the article. In the popup choose **Mac voices →
Mac voice (Start Speaking)**, then **Read page**. The page player offers **Stop**
and **Replay from beginning**. It does not expose pause, speed, time seeking or a
fabricated timeline. Kokoro remains selectable with its separate controls.

Before a subsequent reading starts, the extension requires verified shutdown of
any helper that received speech. Capability-only discovery may close its idle
port through EOF. Replay opens a new connection. A missing helper is an explicit
error and does not
silently switch to Kokoro. The native route creates no browser audio context or
inference worker, and makes no model request.

These AppKit selectors are absent from the public headers; runtime guards fail
explicitly if macOS stops providing them. This is a personal macOS integration,
not a promise of compatibility with future OS versions. Kokoro’s runtime repair and remaining measurement boundaries are documented in
[the GPU review](../../docs/evidence/kokoro-freeze/REVIEW.md). Browser acceptance
and resource use on an actual article still require checks after manual reload.
