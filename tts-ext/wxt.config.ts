import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  extensionApi: 'chrome',
  srcDir: 'src',
  manifest: {
    name: 'TTS Extension',
    version: '1.0',
    description: 'A simple text-to-speech extension for Chrome.',
    permissions: ['activeTab', 'scripting', 'contextMenus', 'storage'],
    host_permissions: ['*://*/*pdf*'],
    content_scripts: [
      {
        matches: ['<all_urls>', '*://*/*pdf*'],
        js: ['content-scripts/main.js'],
        css: ['content-scripts/main.css'],
        run_at: 'document_end'
      }
    ],
    commands: {
      trigger_tts: {
        suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
        description: 'Trigger TTS for selected text'
      }
    },
    web_accessible_resources: [
      {
        resources: [
          "models/Kokoro-82M-v1.0-ONNX/*",
          "models/Kokoro-82M-v1.0-ONNX/onnx/*",
          "onnx/*"
        ],
        matches: ["<all_urls>"] // Or more restrictive if appropriate
      }
    ]
  }
});
