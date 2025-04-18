import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  extensionApi: "chrome",
  srcDir: 'src',
  manifest: {
    content_scripts: [
      {
        matches: ['*://*.google.com/*', '*://google.com/*'],
        js: ['content-scripts/content.js'],
      }
    ]
  }
});
