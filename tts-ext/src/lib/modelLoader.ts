import { KokoroTTS, env } from 'kokoro-js';
import { env as trEnv } from "@huggingface/transformers";
import { detectWebGPU } from '@/lib/utils';
import { setKokoroInstance } from '@/lib/ttsClient';

// Configure WASM and model paths
env.wasmPaths = {
  wasm: chrome.runtime.getURL("onnx/ort-wasm-simd-threaded.jsep.wasm"),
  mjs: chrome.runtime.getURL("onnx/ort-wasm-simd-threaded.jsep.mjs"),
};

trEnv.localModelPath = chrome.runtime.getURL("models");
trEnv.allowRemoteModels = false;
trEnv.allowLocalModels = true;

// Global state for model loading
let modelLoadingPromise: Promise<any> | null = null;
let loadedModel: any = null;
let loadingProgress = 0;
const progressCallbacks: ((progress: number) => void)[] = [];
const toastCallbacks: (() => void)[] = [];

/**
 * Add a callback to receive loading progress updates
 */
export function addProgressCallback(callback: (progress: number) => void): void {
  progressCallbacks.push(callback);
  // If we already have progress, call the callback immediately
  if (loadingProgress > 0) {
    callback(loadingProgress);
  }
}

/**
 * Remove a progress callback
 */
export function removeProgressCallback(callback: (progress: number) => void): void {
  const index = progressCallbacks.indexOf(callback);
  if (index > -1) {
    progressCallbacks.splice(index, 1);
  }
}

/**
 * Add a callback to show toast notifications during first-time loading
 */
export function addToastCallback(callback: () => void): void {
  toastCallbacks.push(callback);
}

/**
 * Remove a toast callback
 */
export function removeToastCallback(callback: () => void): void {
  const index = toastCallbacks.indexOf(callback);
  if (index > -1) {
    toastCallbacks.splice(index, 1);
  }
}

/**
 * Get the current loading progress (0-100)
 */
export function getCurrentProgress(): number {
  return loadingProgress;
}

/**
 * Check if the model is already loaded
 */
export function isModelLoaded(): boolean {
  return loadedModel !== null;
}

/**
 * Lazy load the Kokoro TTS model. Returns a promise that resolves to the model instance.
 * If the model is already loaded or loading, returns the existing promise/instance.
 */
export async function ensureModelLoaded(): Promise<any> {
  // If already loaded, return immediately
  if (loadedModel) {
    return loadedModel;
  }

  // If already loading, return the existing promise
  if (modelLoadingPromise) {
    return modelLoadingPromise;
  }

  // Start loading the model
  const modelId = "Kokoro-82M-v1.0-ONNX";
  const context = typeof window !== 'undefined' && window.chrome?.runtime ? 
    (window.location.href.includes('extension://') ? '[Popup]' : '[Content Script]') : 
    '[Unknown]';
  
  console.log(`${context} Initializing Kokoro model from`, modelId);

  // Trigger toast callbacks for first-time loading
  toastCallbacks.forEach(callback => callback());

  modelLoadingPromise = (async () => {
    try {
      // Detect WebGPU availability
      const isWebGPUAvailable = await detectWebGPU();
      const device: "webgpu" | "cpu" = isWebGPUAvailable ? "webgpu" : "cpu";
      
      console.log(`${context} WebGPU available:`, isWebGPUAvailable);
      if (!isWebGPUAvailable) {
        console.warn(`${context} WebGPU not available, falling back to CPU`);
      }

      // Load the model
      console.log(`${context} Loading Kokoro model...`);
      const model = await KokoroTTS.from_pretrained(modelId, {
        dtype: device === "webgpu" ? "fp32" : "q8",
        device: device,
        progress_callback: (progressInfo) => {
          if (progressInfo.status === "progress") {
            loadingProgress = progressInfo.progress;
            // Notify all registered callbacks
            progressCallbacks.forEach(callback => callback(loadingProgress));
            console.log(`${context} Model loading progress:`, loadingProgress);
          }
        },
      });

      console.log(`${context} Kokoro model loaded successfully`);
      loadedModel = model;
      setKokoroInstance(model);
      
      // Set progress to 100% and notify callbacks
      loadingProgress = 100;
      progressCallbacks.forEach(callback => callback(100));
      
      return model;
    } catch (err) {
      console.error(`${context} Failed to load Kokoro model:`, err);
      modelLoadingPromise = null; // Reset so loading can be retried
      throw err;
    }
  })();

  return modelLoadingPromise;
}

/**
 * Reset the model state (for testing or re-initialization)
 */
export function resetModel(): void {
  loadedModel = null;
  modelLoadingPromise = null;
  loadingProgress = 0;
  setKokoroInstance(null);
}
