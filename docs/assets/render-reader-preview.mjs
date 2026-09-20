// Render the actual player without loading audio, speech models or the extension.
// From a checkout with tts-ext dependencies installed:
// READER_PLAYWRIGHT=/path/to/playwright/index.mjs node docs/assets/render-reader-preview.mjs
// READER_CHROME optionally selects a Chromium executable. No new product dependency.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(process.env.READER_REPOSITORY ?? path.join(directory, '../..'));
const require = createRequire(path.join(repository, 'tts-ext/package.json'));
const { build } = require('esbuild');
const bundle = await build({ entryPoints: [path.join(directory, 'reader-preview.tsx')],
  bundle: true, write: false, outdir: 'preview', format: 'esm', platform: 'browser',
  loader: { '.svg': 'dataurl' },
  tsconfig: path.join(repository, 'tts-ext/tsconfig.json'),
  nodePaths: [path.join(repository, 'tts-ext/node_modules')],
});
const files = new Map(bundle.outputFiles.map(file => ['/' + path.basename(file.path), file.contents]));
files.set('/', Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local Reader — illustrative article</title><link rel="stylesheet" href="/reader-preview.css"><div id="root"></div><script type="module" src="/reader-preview.js"></script></html>'));
const server = http.createServer((request, response) => {
  const content = files.get(request.url.split('?')[0]);
  response.writeHead(content ? 200 : 404, { 'Content-Type': request.url?.endsWith('.js') ? 'text/javascript' : request.url?.endsWith('.css') ? 'text/css' : 'text/html' });
  response.end(content ?? 'Not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
if (process.argv.includes('--serve')) {
  console.log(`README preview: http://127.0.0.1:${server.address().port}/`);
} else {
let browser;
try {
  const { chromium } = await import(process.env.READER_PLAYWRIGHT ?? 'playwright');
  browser = await chromium.launch({ headless: true, executablePath: process.env.READER_CHROME });
  for (const [name, width, height] of [['reader-preview', 1100, 820], ['reader-preview-mobile', 440, 800]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await page.evaluate(() => document.fonts.ready);
    if (errors.length) throw new Error(errors.join('\n'));
    await page.screenshot({ path: path.join(directory, name + '.png') });
    console.log(`${name}.png (${width * 2} × ${height * 2})`);
    await page.close();
  }
  for (const [name, view, width, height] of [['reader-popup', 'popup', 416, 480], ['reader-voices', 'voices', 380, 620]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:${server.address().port}/?view=${view}`);
    const voice = page.getByRole('button', { name: 'Voice: Nicole · American', exact: true });
    await voice.waitFor({ state: 'visible' });
    if (view === 'voices') await voice.click();
    await page.evaluate(() => document.fonts.ready);
    await page.locator(view === 'popup' ? '.popup-preview' : '.voice-preview').screenshot({ path: path.join(directory, name + '.png') });
    console.log(`${name}.png`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
}
