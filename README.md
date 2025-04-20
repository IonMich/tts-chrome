# TTS Chrome Extension

A high‑quality, low‑latency Text‑to‑Speech Chrome extension (Manifest v3) powered by the Kokoro TTS model and a Python WebSocket backend. Select text on any webpage and press **Ctrl+Shift+S** to stream speech through your browser.

## Features

- High‑quality audio using the [Kokoro‑ONNX model](https://github.com/thewh1teagle/kokoro-onnx)
- Low‑latency streaming playback via WebSockets
- 9 built‑in voices (includes one relaxation/sleep mode)
- Support for dozens more voices via `voices-v1.0.bin`
- React-based popup UI with Tailwind CSS, built with WXT

## Prerequisites

- Python 3.12+
- Node.js 18+ (or your preferred package manager)
- Google Chrome

## 1. Clone and Install Dependencies

```bash
git clone https://github.com/IonMich/tts-chrome.git
cd tts-chrome
# Python backend
pip install uv
uv sync
# Frontend
cd tts-ext
npm install
```

## 2. Download Model Files

Place the model files alongside `websocket-server.py` in the project root:

```bash
wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin
wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx
```

## 3. Run the WebSocket Server

```bash
cd tts-chrome
python websocket-server.py
```

The server listens on `ws://localhost:5050` by default.

## 4. Run the Extension in Development

```bash
cd tts-chrome/tts-ext
npm run dev
```

This will launch your browser with the unpacked extension in development mode, with hot reload.

## 5. Build and Pack for Distribution

```bash
npm run build
npm run zip        # Chrome
npm run zip:firefox
```

The distributable zip will be in `tts-ext/dist`.

## Usage

1. Browse any webpage and highlight the text you want to hear.
2. Press **Ctrl+Shift+S** to start streaming speech.
3. Adjust voice or volume in the popup UI.
4. Press the shortcut again or click **Stop** to end speech.

## Customization

- Default voice and gain settings can be configured in `tts-ext/src/lib/ttsClient.ts`.
- WebSocket endpoint can be adjusted in `tts-ext/wxt.config.ts`.
- UI styles are in `tts-ext/src/index.css`. Customize using Tailwind CSS.

## Troubleshooting

- Ensure model files are in the project root.
- Confirm WebSocket address matches in `ttsClient.ts`.
- If the extension doesn't auto-reload, reload manually from `chrome://extensions`.
- Check browser console for errors.

## License

MIT © Ioannis Michaloliakos
