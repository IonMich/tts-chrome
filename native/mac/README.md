# Local Reader Mac Start Speaking host

This optional macOS backend uses the dynamically checked AppKit `NSApplication`
`speakString:`, `stopSpeaking:`, and `isSpeaking` selectors used by Chromium's
Mac Start Speaking integration. The actual voice follows macOS and is deliberately
not identified as Nora or any other public voice identifier.

The Chrome native-messaging relay exists only while Chrome holds the connection.
It launches a hidden agent application through LaunchServices because AppKit speech
does not start from a directly spawned command-line process on this Mac. Relay and
agent communicate through private mode-0600 FIFOs and both exit on connection EOF.
There is no daemon, login item, network listener, PCM capture, or downloaded model.

Protocol requests use an `action` field: `capabilities`, `listVoices`, `speak`, and
`stop`, each with a bounded string `id`. Responses use a `type` field. Speech yields `started` followed by exactly one `ended`,
`cancelled`, or `error`. The mode can stop but cannot pause, seek, return PCM, or
report the underlying macOS voice identifier.

Build the extension and native helper from `tts-ext` with `npm run build:mac`.
Run `npm run compile` and `npm test` for extension checks. `npm run test:native`
is an **audible**, opt-in combined engine/adapter/native-process check; it does
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

The extension closes the native port after capability lookup or terminal speech
events. Replay opens it again. A missing helper is an explicit error and does not
silently switch to Kokoro. The native route creates no browser audio context or
inference worker, and makes no model request.

These AppKit selectors are absent from the public headers; runtime guards fail
explicitly if macOS stops providing them. This is a personal macOS integration,
not a promise of compatibility with future OS versions. Kokoro’s runtime repair and remaining measurement boundaries are documented in
[the GPU review](../../docs/evidence/kokoro-freeze/REVIEW.md). Browser acceptance
and resource use on an actual article still require checks after manual reload.
