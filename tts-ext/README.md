# TTS Chrome Extension (WXT)

A React & Tailwind CSS Chrome extension built with [WXT](https://github.com/wxt-dev/wxt). Streams speech from the Kokoro TTS backend via WebSocket.

## Features

- Manifest v3 Chrome extension powered by Kokoro TTS
- React UI with Tailwind CSS components
- Hot‑reload development with WXT
- Build and package for Chrome & Firefox
- **Text-to-Speech for selected text**: Right-click selected text or use `Ctrl+Shift+S` / `Cmd+Shift+S`
- **Whole page TTS**: Convert entire web pages to audio with `Ctrl+Shift+P` / `Cmd+Shift+P`
- Smart content extraction that filters out navigation, ads, and focuses on main article content
- Queue system for managing multiple TTS requests

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

## Usage

### Keyboard Shortcuts
- **`Ctrl+Shift+S` / `Cmd+Shift+S`**: Convert selected text to speech
- **`Ctrl+Shift+P` / `Cmd+Shift+P`**: Convert entire page to speech

### Context Menu
- Right-click on selected text and choose "Read Text"

### Smart Page Content Detection
The whole page TTS feature intelligently extracts content by:
- Prioritizing main content areas (`article`, `main`, `.content`)
- Including page titles from heading elements (`h1`, `h2`, `h3`)
- Filtering out navigation, headers, footers, ads, and sidebar content
- Falling back to document title if no heading is found

## Configuration

- WebSocket endpoint: `wxt.config.ts`
- Default voice & gain: `src/lib/ttsClient.ts`
- UI styles: `src/index.css`

Refer to the root [README.md](../README.md) for backend setup, model downloads, and usage instructions.
