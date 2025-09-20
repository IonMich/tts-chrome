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

// Disable caching for Chrome extension environment to avoid warnings
trEnv.useBrowserCache = false;
trEnv.useCustomCache = false;

// Global state for model loading
let modelLoadingPromise: Promise<any> | null = null;
let loadedModel: any = null;
let loadingProgress = 0;
let isActivelyLoading = false; // Track if we're currently in the loading process
let hasNotifiedCompletion = false; // Track if we've already notified about 100% completion
const progressCallbacks: ((progress: number) => void)[] = [];
const toastCallbacks: (() => void)[] = [];

/**
 * Add a callback to receive loading progress updates
 */
export function addProgressCallback(callback: (progress: number) => void): void {
  progressCallbacks.push(callback);
  // Only call callback with current progress if model is currently loading (0 < progress < 100)
  // Don't call if progress is 0 (not started) or 100 (already complete)
  if (loadingProgress > 0 && loadingProgress < 100) {
    // Use setTimeout to avoid immediate repeated calls and make it async
    setTimeout(() => {
      // Double-check the progress is still valid and in loading state
      if (loadingProgress > 0 && loadingProgress < 100) {
        callback(loadingProgress);
        console.log(`[ModelLoader] Called initial progress callback: ${loadingProgress}%`);
      }
    }, 0);
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
      isActivelyLoading = true; // Mark as actively loading
      
      // Use multiple yields to give the browser more time for animations
      await new Promise(resolve => setTimeout(resolve, 50)); // Longer initial delay
      
      // Detect WebGPU availability
      const isWebGPUAvailable = await detectWebGPU();
      const device: "webgpu" | "cpu" = isWebGPUAvailable ? "webgpu" : "cpu";
      
      console.log(`${context} WebGPU available:`, isWebGPUAvailable);
      if (!isWebGPUAvailable) {
        console.warn(`${context} WebGPU not available, falling back to CPU`);
      }

      // Another delay before heavy ONNX operations
      await new Promise(resolve => setTimeout(resolve, 50));

      // Load the model
      console.log(`${context} Loading Kokoro model...`);
      
      // Prepare model options
      const modelOptions: any = {
        dtype: device === "webgpu" ? "fp32" : "q8",
        device: device,
      };

      // Only add progress callback if we have registered callbacks
      if (progressCallbacks.length > 0) {
        modelOptions.progress_callback = (progressInfo: any) => {
          if (progressInfo.status === "progress" && isActivelyLoading) {
            const newProgress = progressInfo.progress;
            setTimeout(() => {
              if (newProgress !== loadingProgress) {
                loadingProgress = newProgress;
                progressCallbacks.forEach(callback => callback(loadingProgress));
              }
              if (newProgress === 100) {
                hasNotifiedCompletion = true;
              }
            }, 0);
          }
        };
      }

      const model = await KokoroTTS.from_pretrained(modelId, modelOptions);

      console.log('TTS model loaded successfully');
      loadedModel = model;
      setKokoroInstance(model);
      isActivelyLoading = false;

      // Set progress to 100% and notify callbacks only if we haven't already notified
      if (loadingProgress < 100 && !hasNotifiedCompletion) {
        loadingProgress = 100;
        hasNotifiedCompletion = true;
        progressCallbacks.forEach(callback => callback(100));
      }

      return model;
    } catch (err) {
      console.error('Failed to load TTS model:', err);
      isActivelyLoading = false;
      modelLoadingPromise = null;
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
  isActivelyLoading = false;
  hasNotifiedCompletion = false;
  setKokoroInstance(null);
}
