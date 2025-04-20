# TTS Chrome Extension (WXT)

A React & Tailwind CSS Chrome extension built with [WXT](https://github.com/wxt-dev/wxt). Streams speech from the Kokoro TTS backend via WebSocket.

## Features

- Manifest v3 Chrome extension powered by Kokoro TTS
- React UI with Tailwind CSS components
- Hot‑reload development with WXT
- Build and package for Chrome & Firefox

## Prerequisites

- Node.js 18+
- WXT CLI (installed via `npm install -g wxt` or run from devDependencies)

## Setup

1. Navigate into the extension folder:
   ```bash
   cd tts-ext
   ```
2. Install Node.js dependencies:
   ```bash
   npm install
   ```

## Development

Run the extension in development mode with hot reload:
```bash
npm run dev       # Chrome
npm run dev:firefox  # Firefox
```

## Building & Packaging

1. Build the extension bundles:
   ```bash
   npm run build
   ```
2. Create a distribution zip:
   ```bash
   npm run zip           # Chrome
   npm run zip:firefox   # Firefox
   ```

Generated packages are in `dist/`.

## Configuration

- WebSocket endpoint: `wxt.config.ts`
- Default voice & gain: `src/lib/ttsClient.ts`
- UI styles: `src/index.css`

Refer to the root [README.md](../README.md) for backend setup, model downloads, and usage instructions.
