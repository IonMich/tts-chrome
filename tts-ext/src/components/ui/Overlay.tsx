import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import Loader from "@/components/ui/Loader";
import { Play, Pause, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { splitTextForHybrid } from "@/lib/utilsText";
import {
  processSegmentClientSide, // Import processSegmentClientSide
  stopSpeech,
  reset,
  waitForPlaybackCompletion,
  setCurrentVoice,
  setCurrentSpeed,
  audioContext,
  nextTime,
  preloadedSegments,
  playPreloadedText,
} from "@/lib/ttsClient";

interface OverlayProps {
  text: string;
  voice: string;
  speed: number;
  onClose: () => void;
}

const estimateDuration = (text: string) => text.length / 15;

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const Overlay: React.FC<OverlayProps> = ({ text, voice, speed, onClose }) => {
  // detect each unique text|voice request during render
  const reqKey = text + "|" + voice;
  const prevReqKey = useRef(reqKey);
  const isNewRequest = useRef(true);
  if (reqKey !== prevReqKey.current) {
    prevReqKey.current = reqKey;
    isNewRequest.current = true;
  }

  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showSpinner, setShowSpinner] = useState(true);
  // bump key on each new TTS request to remount Progress without any backward transition
  const [progressKey, setProgressKey] = useState(0);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [totalDuration, setTotalDuration] = useState<number>(
    estimateDuration(text)
  );
  const [isEstimated, setIsEstimated] = useState(true);
  // show loader for new requests or when spinner flag is true
  const shouldShowLoader = isNewRequest.current || showSpinner;

  // reset spinner and progress before paint on every new text/voice
  useLayoutEffect(() => {
    // apply selected speed
    setCurrentSpeed(speed);
    // reapply voice
    setProgressKey((k) => k + 1);
    setProgress(0);
    setElapsed(0);
    setShowSpinner(true);
    setTotalDuration(estimateDuration(text));
    setIsEstimated(true);
  }, [text, voice, speed, onClose]);

  useEffect(() => {
    const key = `${text}|${voice}|${speed}|clientside`; // Add |clientside to key
    // if already preloaded, play stored buffers and skip streaming
    if (preloadedSegments[key]) {
      setShowSpinner(true);
      setIsPlaying(true);
      playPreloadedText(text, voice, speed)
        .then(() => {
          setIsPlaying(false);
          onClose();
        })
        .catch((err) => console.error(err));
      return;
    }
    // start TTS processing
    let cancelled = false;
    // ensure speed is set for socket messages
    setCurrentSpeed(speed);
    setCurrentVoice(voice);
    reset();

    const { firstSegment, secondSegment } = splitTextForHybrid(text);
    // baseline duration at 1× before actual scheduling
    let totalDurationLocal = estimateDuration(text);
    setTotalDuration(totalDurationLocal);
    let barStart = 0;
    let intervalId: number | undefined;

    const onFirstChunk = () => {
      isNewRequest.current = false;
      setShowSpinner(false);
      barStart = audioContext.currentTime;
      intervalId = window.setInterval(() => {
        const elapsedReal = audioContext.currentTime - barStart;
        const elapsedBaseline = elapsedReal * speed;
        // percent based on baseline total duration (estimate until actual)
        const pct = Math.min(100, (elapsedBaseline / totalDurationLocal) * 100);
        setElapsed(elapsedBaseline);
        setProgress(pct);
      }, 100);
    };

    (async () => {
      setIsPlaying(true);
      try {
        // process first segment and then estimate full duration
        await processSegmentClientSide(firstSegment, onFirstChunk); // Use processSegmentClientSide
        if (secondSegment) {
          // measure real playback time for first segment
          const firstReal = nextTime! - barStart;
          const estBaselineTotal =
            (firstReal * speed * text.length) / firstSegment.length;
          totalDurationLocal = estBaselineTotal;
          setTotalDuration(estBaselineTotal);
          setIsEstimated(true);
          await processSegmentClientSide(secondSegment); // Use processSegmentClientSide
          // after scheduling both segments, compute final baseline total
          const realTotal = nextTime! - barStart;
          totalDurationLocal = realTotal * speed;
          setTotalDuration(totalDurationLocal);
          setIsEstimated(false);
        } else {
          // only one segment: final total
          const realTotal = nextTime! - barStart;
          totalDurationLocal = realTotal * speed;
          setTotalDuration(totalDurationLocal);
          setIsEstimated(false);
        }
        await waitForPlaybackCompletion();
      } catch (e) {
        console.error(e);
      } finally {
        if (intervalId !== undefined) clearInterval(intervalId);
        if (!cancelled) {
          setElapsed(totalDurationLocal);
          setProgress(100);
          setIsPlaying(false);
          setIsPaused(false);
          setShowSpinner(false);
          onClose();
        }
      }
    })();

    return () => {
      cancelled = true;
      if (intervalId !== undefined) clearInterval(intervalId);
      stopSpeech();
    };
  }, [text, voice, speed, onClose]);

  const handleToggle = async () => {
    if (!isPaused) {
      await audioContext.suspend();
      setIsPaused(true);
    } else {
      await audioContext.resume();
      setIsPaused(false);
    }
  };

  const handleStop = () => {
    stopSpeech();
    onClose();
  };

  return (
    <div
      className={cn(
        "fixed right-4 top-1/2 transform -translate-y-1/2 z-[9999]"
      )}
    >
      <Card className="w-36 p-4 gap-2">
        {shouldShowLoader ? (
          <Loader className="h-8 w-8 mx-auto my-1" />
        ) : (
          <div className="w-28 mt-4">
            <Progress key={progressKey} value={progress} className="w-28" />
            <div className="flex justify-center text-xs mt-1">
              <span className={isEstimated ? "italic text-gray-400" : ""}>
                {`${formatTime(elapsed)}/${
                  isEstimated
                    ? `~${formatTime(totalDuration)}`
                    : formatTime(totalDuration)
                }`}
              </span>
            </div>
          </div>
        )}
        <div className="flex justify-center space-x-2">
          <Button size="sm" onClick={handleToggle} disabled={!isPlaying}>
            {isPaused || !isPlaying ? <Play size={16} /> : <Pause size={16} />}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleStop}
            disabled={!isPlaying}
          >
            <StopCircle size={16} />
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default Overlay;
