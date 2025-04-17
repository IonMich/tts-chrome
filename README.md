# TTS Chrome Extension

A high‑quality, low‑latency Text‑to‑Speech Chrome extension (Manifest v3) powered by the Kokoro TTS model and a Python WebSocket backend. Select text on any webpage and press a simple keyboard shortcut to stream speech through your browser.

## Features

- High‑quality audio using the [Kokoro‑ONNX model](https://github.com/thewh1teagle/kokoro-onnx)
- Low‑latency streaming playback via WebSockets
- 9 built‑in voices (includes one relaxation/sleep mode)
- Support for dozens more voices via `voices.json` or `voices.bin`
- Keyboard shortcut: **Ctrl+Shift+S** to speak selected text
- Quick voice selection and volume control in extension popup
- Graceful stop and reset of active speech streams

## Prerequisites

- Python 3.12+
- Google Chrome

## 1. Install Python Backend

1. Clone this repository (tts-chrome):
   ```bash
   git clone https://github.com/IonMich/tts-chrome.git
   cd tts-chrome
   ```
2. Ensure you have **UV** installed globally:
   ```bash
   pip install uv
   ```
3. Install project dependencies via UV:
   ```bash
   uv sync
   ```
4. Download model files (not included in this repo):
   ```bash
   wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin
   wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx
   ```
5. Verify both files (`voices-v1.0.bin` & `kokoro-v1.0.onnx`) are present alongside `websocket-server.py`.

## 2. Run the WebSocket Server

From the `chrome-tts` directory:
```bash
python websocket-server.py
```
The server listens on `ws://localhost:5050` by default.

## 3. Install the Chrome Extension

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (toggle top right).
3. Click **Load unpacked** and select the `tts_extension/` folder from this project.

## 4. Usage

1. Browse any webpage and highlight the text you want to hear.
2. Press **Ctrl+Shift+S** to start streaming speech.
3. Adjust voice in the popup if desired.
4. To stop speech, click **Stop** in the controls or press the shortcut again.

## Customization

- **Default voice**: Edit `tts_extension/js/tts.js` to set `currentVoice`.
- **Add voices**: Add new visible options to the `popup.html` file, using options from `voices.json` or `voices.bin`.
- **Adjust gain**: Tweak `gainNode.gain.value` in `tts.js`.

## Troubleshooting

- Ensure model files are in the `chrome-tts` directory.
- Confirm WebSocket address (`ws://localhost:5050`) matches in `tts.js`.
- Check firewall or proxy settings if no connection.

## License

MIT © Ioannis Michaloliakos
