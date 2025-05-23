import React from 'react';
import { createRoot } from 'react-dom/client';
import OverlayManager from '@/components/ui/OverlayManager';
import '@/index.css';
import { KokoroTTS, env } from 'kokoro-js'; // Import KokoroTTS and env
import { detectWebGPU } from '@/lib/utils'; // Import detectWebGPU
import { setKokoroInstance } from '@/lib/ttsClient'; // Import setKokoroInstance
import { env as trEnv } from "@huggingface/transformers";

// Ensure WASM and MJS files are served via extension URL for content script
env.wasmPaths = {
  wasm: chrome.runtime.getURL("onnx/ort-wasm-simd-threaded.jsep.wasm"),
  mjs: chrome.runtime.getURL("onnx/ort-wasm-simd-threaded.jsep.mjs"),
};

trEnv.localModelPath = chrome.runtime.getURL("models");
trEnv.allowRemoteModels = false;
trEnv.allowLocalModels = true;

export default defineContentScript({
  matches: ['<all_urls>', '*://*/*pdf*'],
  cssInjectionMode: 'ui',
  runAt: 'document_end',
  async main(ctx) {
    // Load Kokoro Model in the content script context
    const modelId = "Kokoro-82M-v1.0-ONNX";
    console.log("[Content Script] Initializing Kokoro model from", modelId);
    let device: "webgpu" | "cpu" = "webgpu";
    try {
      const isWebGPUAvailable = await detectWebGPU();
      device = isWebGPUAvailable ? "webgpu" : "cpu";
      console.log("[Content Script] WebGPU available:", isWebGPUAvailable);
      if (!isWebGPUAvailable) {
        console.warn("[Content Script] WebGPU not available, falling back to CPU");
      }

      const model = await KokoroTTS.from_pretrained(modelId, {
        dtype: device === "webgpu" ? "fp32" : "q8",
        device: device,
        // Add progress_callback if you want to show loading in the overlay or log it
        progress_callback: (progressInfo) => {
          if (progressInfo.status === 'progress') {
            console.log("[Content Script] Model loading progress:", progressInfo.progress);
          }
        }
      });
      console.log("[Content Script] Kokoro model loaded");
      setKokoroInstance(model); // Set the instance for ttsClient
    } catch (err) {
      console.error("[Content Script] Failed to load Kokoro model:", err);
      // signalKokoroInstanceLoadError(err); // Removed as per the change
      // Optionally, inform the user or disable TTS functionality in the overlay
      // For now, we'll let it proceed, and ttsClient functions will reject if instance is null
    }

    const ui = await createShadowRootUi(ctx, {
      name: 'tts-overlay',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        const host = document.createElement('div');
        container.append(host);
        const root = createRoot(host);
        // render the queue-aware manager
        root.render(<OverlayManager host={host} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
