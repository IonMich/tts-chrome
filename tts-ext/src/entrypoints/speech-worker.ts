import { KokoroTTS, env as kokoroEnv } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import { guardTokenizer, SegmentTooLong, splitOversized } from '@/lib/tokenGuard';
import { VOICES } from '@/lib/readerProtocol';
import { trimSpeechPadding } from '@/lib/speechAudio';
import { generateLocalVoiceAudio } from '@/lib/kokoroAudioLifetime';

export default defineUnlistedScript(() => {
  const scope = self as unknown as { location: Location; onmessage: ((event: MessageEvent) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };
  const root = new URL('./', scope.location.href);
  env.localModelPath = new URL('models/', root).href;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useBrowserCache = false; // installed package is the persistent cache, not an evictable HTTP cache
  env.useCustomCache = false;
  const threads = self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
  env.backends.onnx.wasm!.numThreads = threads;
  env.backends.onnx.wasm!.proxy = false;
  kokoroEnv.wasmPaths = {
    wasm: new URL('onnx/ort-wasm-simd-threaded.asyncify.wasm', root).href,
    mjs: new URL('onnx/ort-wasm-simd-threaded.asyncify.mjs', root).href,
  };
  let model: KokoroTTS | undefined;
  let backend = 'webgpu';
  let loading = false;
  const voices = new Map<string, Float32Array>();
  async function localVoice(name: string) {
    if (!(VOICES as readonly string[]).includes(name)) throw new Error('Voice is not installed.');
    let data = voices.get(name);
    if (!data) {
      const response = await fetch(new URL('models/Kokoro-82M-v1.0-ONNX/voices/' + name + '.bin', root));
      if (!response.ok) throw new Error('Missing installed voice file: ' + name);
      data = new Float32Array(await response.arrayBuffer());
      if (data.length < 510 * 256) throw new Error('Installed voice file is incomplete: ' + name);
      voices.set(name, data);
    }
    return data;
  }
  scope.onmessage = async event => {
    const message = event.data;
    try {
      if (message.type === 'load') {
        backend = message.backend === 'wasm' ? 'wasm' : 'webgpu'; loading = true;
        model = await KokoroTTS.from_pretrained('Kokoro-82M-v1.0-ONNX', backend === 'webgpu' ? { dtype: 'fp32', device: 'webgpu' } : { dtype: 'fp32', device: 'wasm' });
        loading = false;
        model.tokenizer = guardTokenizer(model.tokenizer);
        // kokoro-js1.2.1's default voice helper fetches from a remote URL. Override
        // only this documented generation stage; keep its normalization/phonemizer.
        model.generate_from_ids = async (ids, { voice = 'af_sarah', speed = 1 } = {}) => {
          const data = await localVoice(voice);
          const index = 256 * Math.min(Math.max(ids.dims.at(-1)! - 2, 0), 509);
          return generateLocalVoiceAudio(inputs => model!.model(inputs), ids, data.slice(index, index + 256), speed);
        };
        scope.postMessage({ type: 'ready', backend: backend === 'webgpu' ? 'webgpu-fp32' : 'wasm-fp32', threads, crossOriginIsolated: self.crossOriginIsolated });
      } else if (message.type === 'generate') {
        if (!model) throw new Error('The voice is not ready.');
        const started = performance.now();
        const output = await model.generate(message.text, { voice: message.voice, speed: message.speed });
        const raw = output.audio;
        const trimmed = trimSpeechPadding(raw, output.sampling_rate, message.text);
        const samples = trimmed.samples;
        scope.postMessage({ type: 'audio', index: message.index, samples, sampleRate: output.sampling_rate, generationMs: performance.now() - started, padding: { removedStartSec: trimmed.removedStartSec, removedEndSec: trimmed.removedEndSec, originalSec: raw.length / output.sampling_rate } }, [samples.buffer]);
      }
    } catch (error) {
      if (loading && backend === 'webgpu') { scope.postMessage({ type: 'fallback', reason: error instanceof Error ? error.message : String(error) }); return; }
      if (error instanceof SegmentTooLong && message.type === 'generate') {
        scope.postMessage({ type: 'split', index: message.index, parts: splitOversized(message.text), tokenCount: error.tokenCount }); return;
      }
      scope.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  };
});
