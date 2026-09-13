import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Tensor } from '@huggingface/transformers';

const moduleOf = async path => {
  const result = await build({
    entryPoints: [new URL('../src/lib/' + path, import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    external: ['@huggingface/transformers'],
  });
  const code = result.outputFiles[0].text.replace(
    '"@huggingface/transformers"',
    JSON.stringify(import.meta.resolve('@huggingface/transformers')),
  );
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
};

const observeDisposal = tensor => {
  let calls = 0;
  const dispose = tensor.dispose.bind(tensor);
  tensor.dispose = () => { calls++; dispose(); };
  return () => calls;
};

test('Kokoro audio survives output disposal while caller-owned input IDs remain valid', async () => {
  const { generateLocalVoiceAudio } = await moduleOf('kokoroAudioLifetime.ts');
  const ids = new Tensor('int64', [0n, 1n, 0n], [1, 3]);
  const idsDisposed = observeDisposal(ids);
  let styleDisposed, speedDisposed, waveformDisposed;
  const expected = new Float32Array([0, 0.25, -0.5]);

  const audio = await generateLocalVoiceAudio(async inputs => {
    styleDisposed = observeDisposal(inputs.style);
    speedDisposed = observeDisposal(inputs.speed);
    assert.deepEqual(inputs.style.dims, [1, 256]);
    assert(Math.abs(inputs.speed.data[0] - 1.2) < 1e-6);
    const waveform = new Tensor('float32', expected, [1, expected.length]);
    waveformDisposed = observeDisposal(waveform);
    return { waveform };
  }, ids, new Float32Array(256).fill(0.125), 1.2);

  assert.equal(audio.audio, expected, 'the helper must not allocate another PCM copy');
  assert.deepEqual(Array.from(audio.audio), [0, 0.25, -0.5]);
  assert.equal(waveformDisposed(), 1);
  assert.equal(styleDisposed(), 1);
  assert.equal(speedDisposed(), 1);
  assert.equal(idsDisposed(), 0);
  assert.deepEqual(Array.from(ids.data), [0n, 1n, 0n]);
  ids.dispose();
});

test('Kokoro worker-owned inputs are disposed when inference rejects', async () => {
  const { generateLocalVoiceAudio } = await moduleOf('kokoroAudioLifetime.ts');
  const ids = new Tensor('int64', [0n, 1n], [1, 2]);
  const idsDisposed = observeDisposal(ids);
  let styleDisposed, speedDisposed;

  await assert.rejects(generateLocalVoiceAudio(async inputs => {
    styleDisposed = observeDisposal(inputs.style);
    speedDisposed = observeDisposal(inputs.speed);
    throw new Error('inference failed');
  }, ids, new Float32Array(256), 1), /inference failed/);

  assert.equal(styleDisposed(), 1);
  assert.equal(speedDisposed(), 1);
  assert.equal(idsDisposed(), 0);
  assert.deepEqual(Array.from(ids.data), [0n, 1n]);
  ids.dispose();
});
