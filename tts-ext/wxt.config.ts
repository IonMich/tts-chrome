import { defineConfig } from 'wxt';
export default defineConfig({
  modules: ['@wxt-dev/module-react'], extensionApi: 'chrome', srcDir: 'src',
  // Use the released native WebGPU execution provider. Transformers 3.5.1's
  // original development runtime used JSEP and reproduced severe buffer churn.
  vite: () => ({ resolve: { alias: [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/webgpu' }] } }),
  manifest: {
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
    name: 'Local Reader', version: '2.1.2', minimum_chrome_version: '116',
    description: 'Read selected text or articles aloud using an installed local voice. No account or speech service.',
    permissions: ['activeTab', 'scripting', 'contextMenus', 'storage', 'offscreen', 'nativeMessaging'],
    web_accessible_resources: [{ resources: ['content-scripts/main.css'], matches: ['<all_urls>'] }],
    commands: {
      trigger_tts: { suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' }, description: 'Read selected text aloud' },
      trigger_page_tts: { suggested_key: { default: 'Ctrl+Shift+P', mac: 'Command+Shift+P' }, description: 'Read the current article aloud' },
    },
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'; media-src 'self' blob:;" },
  },
});
