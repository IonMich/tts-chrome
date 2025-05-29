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
import Loader from "@/components/ui/Loader";
import {
  // processSegment,
  stopSpeech,
  reset,
  waitForPlaybackCompletion,
  setCurrentVoice,
  setCurrentSpeed,
  audioContext,
  processSegmentClientSide, // Import client-side function
} from "@/lib/ttsClient";
import { 
  addProgressCallback, 
  removeProgressCallback, 
  getCurrentProgress, 
  isModelLoaded 
} from "@/lib/modelLoader";

function App() {
  // Model loading state
  const [loadingProgress, setLoadingProgress] = useState<number>(0); // New state for loading progress
  const [isModelReady, setIsModelReady] = useState<boolean>(false); // Track if model is loaded
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(false); // Track if model is currently being loaded
  // state for voice selection, input text, and speaking status
  const [voice, setVoice] = useState<string>("af_sarah");
  // state for playback speed
  const [speed, setSpeed] = useState<string>("1.0");
  const [inputText, setInputText] = useState<string>("");
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [queueEnabled, setQueueEnabled] = useState<boolean>(true);

  // Set up progress callback for model loading
  useEffect(() => {
    // Check if model is already loaded
    const modelLoaded = isModelLoaded();
    const currentProgress = getCurrentProgress();
    setIsModelReady(modelLoaded);
    setLoadingProgress(currentProgress);
    console.log("Initial model state:", { modelLoaded, progress: currentProgress });

    // Only set up progress callback if model is not already fully loaded
    if (!modelLoaded || currentProgress < 100) {
      // Set up progress callback
      const progressCallback = (progress: number) => {
        console.log("Progress callback:", progress);
        setLoadingProgress(progress);
        if (progress === 100) {
          setIsModelReady(true);
          console.log("Model loading complete");
        }
      };

      addProgressCallback(progressCallback);

      // Cleanup callback on unmount
      return () => {
        removeProgressCallback(progressCallback);
      };
    } else {
      console.log("Model already loaded, skipping progress callback setup");
    }
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
      {loadingProgress > 0 && loadingProgress < 100 && ( // Display progress bar only when actively loading
        <div className="p-4">
          <Label>Loading Model...</Label>
          <Progress value={loadingProgress} className="w-full" />
        </div>
      )}
      {/* Always display UI elements - model will load when needed */}
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
              disabled={!inputText.trim() && !isSpeaking}
              onClick={async () => {
                if (!isSpeaking) {
                  // start playback
                  const fullText = inputText.trim();
                  if (!fullText) {
                    console.warn("No text provided");
                    return;
                  }
                  
                  // Always start loading indicator when processing starts
                  setIsLoadingModel(true);
                  console.log("Starting spinner - processing beginning");
                  
                  setIsSpeaking(true);
                  setIsPaused(false);
                  // Stop any existing speech and streaming processes before starting new one
                  stopSpeech();
                  reset();
                  
                  try {
                    // Process the full text directly - this will trigger model loading if needed
                    console.log("About to call processSegmentClientSide");
                    await processSegmentClientSide(fullText, (actualDuration) => {
                      // Audio generation is complete and playback is starting
                      console.log("Audio generation complete and playback starting - hiding spinner");
                      setIsLoadingModel(false);
                    });
                    console.log("processSegmentClientSide completed");
                  } catch (e) {
                    console.error("Error processing text:", e);
                    setIsSpeaking(false);
                    setIsPaused(false);
                    setIsLoadingModel(false);
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
                setIsLoadingModel(false); // Stop loading indicator
              }}
            >
              <StopCircle size={16} />
            </Button>
            {isLoadingModel && (
              <Loader className="h-6 w-6 my-0" />
            )}
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
    </Card>
  );
}

export default App;
