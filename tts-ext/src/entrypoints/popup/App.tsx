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
import { splitTextForHybrid } from "@/lib/utilsText";
import {
  processSegment,
  stopSpeech,
  reset,
  waitForPlaybackCompletion,
  setCurrentVoice,
  audioContext,
} from "@/lib/ttsClient";

function App() {
  // state for voice selection, input text, and speaking status
  const [voice, setVoice] = useState<string>("af_sarah");
  const [inputText, setInputText] = useState<string>("");
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [queueEnabled, setQueueEnabled] = useState<boolean>(false);

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
  }, []);

  // load persisted queue setting
  useEffect(() => {
    chrome.storage.sync.get(["queueEnabled"]).then(({ queueEnabled: qe }) => {
      setQueueEnabled(!!qe);
    });
  }, []);

  return (
    <Card className="m-1 p-2 min-w-[300px] rounded-sm shadow-md">
      <div className="flex items-center justify-center m-4 p-4">
        <h2 className="text-xl font-medium">TTS Converter</h2>
      </div>
      <div className="mb-4">
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
              reset();
              const { firstSegment, secondSegment } = splitTextForHybrid(
                fullText,
                15,
                3
              );
              try {
                await processSegment(firstSegment);
                if (secondSegment) await processSegment(secondSegment);
              } catch (e) {
                console.error("Error processing segments:", e);
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
          {!isSpeaking || isPaused ? <Play size={16} /> : <Pause size={16} />}
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
    </Card>
  );
}

export default App;
