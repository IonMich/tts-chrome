import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
async function moduleOf(path) {
  const result = await build({ entryPoints: [root + path], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, tsconfig: root + 'tsconfig.json' });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require });
  return module.exports;
}
const { validateRequest } = await moduleOf('src/lib/readerProtocol.ts');
const { ReaderPlayer } = await moduleOf('src/components/reader/ReaderPlayer.tsx');

test('Validated labels follow the voice ID, including requests with an old cached name', () => {
  for (const [voice, expected] of [[undefined, 'Sarah · American'], ['af_nicole', 'Nicole · American'], ['bf_lily', 'Lily · British'], ['mac:macos-start-speaking', 'Mac voice (Start Speaking)']]) {
    const request = validateRequest({ text: 'Read this.', voice, voiceName: 'A stale name from a previous selection' });
    assert.equal(request.voiceName, expected);
  }
  assert.throws(() => validateRequest({ text: 'Read this.', voice: 'not-a-voice', voiceName: 'Mac voice (Start Speaking)' }), /not available/);
});

test('A player restored with stale metadata shows the actual voice, including native controls', () => {
  const state = { phase: 'playing', voice: 'af_nicole', voiceName: 'Mac voice (Start Speaking)', speed: 1, elapsedSec: 0, durationSec: null, bufferedSec: 0 };
  const controls = { onPause() {}, onResume() {}, onClose() {} };
  const kokoro = renderToStaticMarkup(React.createElement(ReaderPlayer, { ...controls, state }));
  assert.match(kokoro, />Nicole</);assert.match(kokoro, />American</);assert.doesNotMatch(kokoro, /Mac voice|Start Speaking/);
  const native = renderToStaticMarkup(React.createElement(ReaderPlayer, { ...controls, state: { ...state, voice: 'mac:macos-start-speaking', voiceName: 'Nicole · American', speechMode: 'system' } }));
  assert.match(native, />Mac voice</);assert.match(native, />Start Speaking</);assert.match(native, /Stop reading/);
  assert.doesNotMatch(native, /Nicole|type="range"|Pause reading/);
  const pausedNative = renderToStaticMarkup(React.createElement(ReaderPlayer, { ...controls, state: { ...state, phase: 'paused', voice: 'mac:macos-start-speaking', speechMode: 'system' } }));
  assert.match(pausedNative, /Resume reading/);
  assert.doesNotMatch(pausedNative, /Stop reading|Replay/);
});
