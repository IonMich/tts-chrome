import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, Play, StopCircle, Pause, List, CheckIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Progress } from "@/components/ui/progress"; // Added import
import {
  // processSegment,
  stopSpeech,
  reset,
  waitForPlaybackCompletion,
  setCurrentVoice,
  setCurrentSpeed,
  audioContext,
  setKokoroInstance, // Import setKokoroInstance
  processSegmentClientSide, // Import client-side function
} from "@/lib/ttsClient";
import { detectWebGPU } from "@/lib/utils";
import { env, KokoroTTS } from "kokoro-js";
import { env as trEnv } from "@huggingface/transformers";

env.wasmPaths = {
  wasm: chrome.runtime.getURL("onnx/ort-wasm-simd-threaded.jsep.wasm"),
  mjs: chrome.runtime.getURL("onnx/ort-wasm-simd-threaded.jsep.mjs"),
};

// trEnv.localModelPath = chrome.runtime.getURL("models"); // Optional
// trEnv.allowRemoteModels = false;
trEnv.allowLocalModels = true;

function App() {
  // kokoro-js model state
  const [kokoro, setKokoro] = useState<any>(null);
  const [loadingProgress, setLoadingProgress] = useState<number>(0); // New state for loading progress
  // state for voice selection, input text, and speaking status
  const [voice, setVoice] = useState<string>("af_sarah");
  // state for playback speed
  const [speed, setSpeed] = useState<string>("1.0");
  const [inputText, setInputText] = useState<string>("");
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [queueEnabled, setQueueEnabled] = useState<boolean>(true);

  let device: "webgpu" | "cpu" = "webgpu";

  // load kokoro-js model once on mount
  useEffect(() => {
    const modelId = "Kokoro-82M-v1.0-ONNX";
    console.log("Initializing Kokoro model from", modelId);
    // Check if WebGPU is available
    detectWebGPU().then((isAvailable) => {
      device = isAvailable ? "webgpu" : "cpu";
      console.log("WebGPU available:", isAvailable);
      if (!isAvailable) {
        console.warn("WebGPU not available, falling back to CPU");
      }
      // Load the Kokoro model
      console.log("Loading Kokoro model...");
      KokoroTTS.from_pretrained(modelId, {
        dtype: device === "webgpu" ? "fp32" : "q8",
        device: device,
        progress_callback: (progressInfo) => {
          if (progressInfo.status === "progress") {
            setLoadingProgress(progressInfo.progress); // Update loading progress state
          }
        },
      })
        .then((model) => {
          console.log("Kokoro model loaded");
          setKokoro(model);
          setKokoroInstance(model); // Set kokoro instance in ttsClient
        })
        .catch((err) => {
          console.error("Failed to load Kokoro model:", err);
          alert(
            "Failed to load Kokoro model. Please check the console for details."
          );
        });
    });
  }, []);

  // load persisted voice on mount
  useEffect(() => {
    const storageSync = globalThis.chrome?.storage?.sync;
    if (!storageSync) {
      console.warn("chrome.storage.sync not available");
      return;
    }
    storageSync.get(["voice"], ({ voice: stored }) => {
      const v = stored || "af_sarah";
      setVoice(v);
      setCurrentVoice(v);
    });
    // load persisted speed on mount
    storageSync.get(["speed"], ({ speed: storedSpeed }) => {
      const sp = storedSpeed ?? 1.0;
      setSpeed(sp.toFixed(1));
      setCurrentSpeed(sp);
    });
  }, []);

  // load persisted queue setting
  useEffect(() => {
    chrome.storage.sync.get(["queueEnabled"]).then(({ queueEnabled: qe }) => {
      setQueueEnabled(!!qe);
    });
  }, []);

  return (
    <Card className="m-1 p-2 gap-2 min-w-[300px] rounded-sm shadow-md">
      <div className="flex items-center justify-center m-4 p-4">
        <h2 className="text-xl font-medium">TTS Converter</h2>
      </div>
      {!kokoro && ( // Display progress bar if kokoro model is not loaded
        <div className="p-4">
          <Label>Loading Model...</Label>
          <Progress value={loadingProgress} className="w-full" />
        </div>
      )}
      {kokoro && ( // Display UI elements only if kokoro model is loaded
        <>
          <div className="mb-4 flex gap-8">
            <Label htmlFor="voiceSelect">Voice</Label>
            <Select
              value={voice}
              onValueChange={(value) => {
                setVoice(value);
                setCurrentVoice(value);
                const storageSync = globalThis.chrome?.storage?.sync;
                if (storageSync) {
                  storageSync.set({ voice: value });
                }
              }}
            >
              <SelectTrigger id="voiceSelect" className="w-full mb-2">
                <SelectValue placeholder="Select a voice" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>US Female</SelectLabel>
                  <SelectItem value="af_sarah">Sarah (Default)</SelectItem>
                  <SelectItem value="af_alloy">Alloy</SelectItem>
                  <SelectItem value="af_nicole">
                    Nicole (Relaxation/Sleep)
                  </SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>US Male</SelectLabel>
                  <SelectItem value="am_adam">Adam</SelectItem>
                  <SelectItem value="am_michael">Michael</SelectItem>
                  <SelectItem value="am_onyx">Onyx</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>GB</SelectLabel>
                  <SelectItem value="bf_alice">Alice</SelectItem>
                  <SelectItem value="bf_lily">Lily</SelectItem>
                  <SelectItem value="bm_fable">Fable</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="mb-4 flex gap-8">
            <Label htmlFor="speedSelect">Speed</Label>
            <Select
              value={speed}
              onValueChange={(value) => {
                setSpeed(value);
                const sp = parseFloat(value);
                setCurrentSpeed(sp);
                const storageSync = globalThis.chrome?.storage?.sync;
                if (storageSync) storageSync.set({ speed: sp });
              }}
            >
              <SelectTrigger id="speedSelect" className="w-24 mb-2">
                <SelectValue placeholder="Select speed" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="0.5">0.5x</SelectItem>
                  <SelectItem value="0.75">0.75x</SelectItem>
                  <SelectItem value="1.0">1x</SelectItem>
                  <SelectItem value="1.25">1.25x</SelectItem>
                  <SelectItem value="1.5">1.5x</SelectItem>
                  <SelectItem value="2.0">2x</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Textarea
            id="inputText"
            placeholder="Enter text here..."
            rows={5}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="w-full mb-4"
          />
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={async () => {
                if (!isSpeaking) {
                  // start playback
                  const fullText = inputText.trim();
                  if (!fullText) {
                    console.warn("No text provided");
                    return;
                  }
                  setIsSpeaking(true);
                  setIsPaused(false);
                  // Stop any existing speech and streaming processes before starting new one
                  stopSpeech();
                  reset();
                  // const { firstSegment, secondSegment } =
                  //   splitTextForHybrid(fullText); // Removed
                  try {
                    // Process the full text directly
                    await processSegmentClientSide(fullText, () => {
                      // This callback is for the first chunk of audio data.
                      // In the App component, we don't have the same detailed progress UI as Overlay,
                      // so this might be a no-op or used for simpler feedback if needed.
                      console.log("First chunk of audio data received in App.");
                    });
                    // if (secondSegment) { // Removed
                    //   await processSegmentClientSide(secondSegment);
                    // }
                  } catch (e) {
                    console.error("Error processing text:", e);
                    setIsSpeaking(false);
                    setIsPaused(false);
                    return;
                  }
                  await waitForPlaybackCompletion();
                  setIsSpeaking(false);
                  setIsPaused(false);
                } else if (!isPaused) {
                  // pause playback
                  await audioContext.suspend();
                  setIsPaused(true);
                } else {
                  // resume playback
                  await audioContext.resume();
                  setIsPaused(false);
                }
              }}
            >
              {!isSpeaking || isPaused ? (
                <Play size={16} />
              ) : (
                <Pause size={16} />
              )}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!isSpeaking}
              onClick={() => {
                // stop playback entirely
                stopSpeech();
                setIsSpeaking(false);
                setIsPaused(false);
              }}
            >
              <StopCircle size={16} />
            </Button>
            <Toggle
              pressed={queueEnabled}
              onPressedChange={(next) => {
                setQueueEnabled(next);
                chrome.storage.sync.set({ queueEnabled: next });
              }}
              variant="outline"
              size="sm"
              className="ml-auto"
              title={queueEnabled ? "Queue mode on" : "Queue mode off"}
              aria-label="Toggle request queue mode"
            >
              {queueEnabled ? (
                <div className="flex items-center">
                  <List size={16} />
                  <CheckIcon size={16} />
                </div>
              ) : (
                <List size={16} />
              )}
            </Toggle>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                /* clear input and reset state */
                setInputText("");
                setVoice("af_sarah");
                setIsSpeaking(false);
              }}
            >
              <Eraser size={16} />
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

export default App;
