import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import Loader from "@/components/ui/Loader";
import { Play, Pause, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  processSegmentClientSide, // Import processSegmentClientSide
  processSegmentClientSideStreaming, // Import streaming version
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

  // Moved totalDurationLocal declaration here to be accessible by onFirstChunk closure
  let totalDurationLocal = estimateDuration(text);

  // reset spinner and progress before paint on every new text/voice
  useLayoutEffect(() => {
    // apply selected speed
    setCurrentSpeed(speed);
    // reapply voice
    setProgressKey((k) => k + 1);
    setProgress(0);
    setElapsed(0);
    setShowSpinner(true);
    totalDurationLocal = estimateDuration(text); // Initialize/reset here
    setTotalDuration(totalDurationLocal);
    setIsEstimated(true);
  }, [text, voice, speed, onClose]);

  useEffect(() => {
    const key = `${text}|${voice}|${speed}|clientside`; // Add |clientside to key
    // if already preloaded, play stored buffers and skip streaming
    if (preloadedSegments[key]) {
      setShowSpinner(true);
      setIsPlaying(true);
      setIsEstimated(false); // Preloaded text has actual duration, not estimated
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

    // const { firstSegment, secondSegment } = splitTextForHybrid(text); // Removed
    // baseline duration at 1× before actual scheduling - totalDurationLocal is initialized in useLayoutEffect
    // setTotalDuration(totalDurationLocal); // Already set by useLayoutEffect

    let barStart = 0;
    let intervalId: number | undefined;

    const onFirstChunk = (actualDuration?: number) => {
      if (cancelled) return;
      isNewRequest.current = false;
      setShowSpinner(false);
      barStart = audioContext.currentTime;
      console.log(`[Overlay] onFirstChunk: barStart=${barStart}, audioContext.currentTime=${audioContext.currentTime}, actualDuration=${actualDuration}`);
      
      // For streaming, we get the first chunk duration but not the total duration yet
      // So we don't set isEstimated to false here - keep it estimated until streaming completes
      if (actualDuration) {
        console.log(`[Overlay] First chunk duration: ${actualDuration}s (real) - keeping estimated until streaming completes`);
      }
      
      if (intervalId !== undefined) clearInterval(intervalId);
      intervalId = window.setInterval(() => {
        if (cancelled || barStart === 0 || !audioContext) {
            if (intervalId !== undefined) clearInterval(intervalId);
            return;
        }
        const elapsedReal = audioContext.currentTime - barStart;
        const elapsedBaseline = elapsedReal * speed;
        // totalDurationLocal is updated in the outer scope, interval sees the update
        const pct = Math.min(100, (elapsedBaseline / totalDurationLocal) * 100);
        setElapsed(elapsedBaseline);
        setProgress(pct);
      }, 100);
    };

    (async () => {
      setIsPlaying(true);
      try {
        if (text && text.trim().length > 0) {
          // Use streaming TTS for better user experience
          await processSegmentClientSideStreaming(
            text, 
            onFirstChunk,
            (progress) => {
              // Update total duration as we process more segments
              // This gives us a better estimate during streaming
              const estimatedRemainingDuration = estimateDuration(text.substring(progress.totalProcessed));
              const processedDuration = (nextTime || audioContext.currentTime) - barStart;
              totalDurationLocal = (processedDuration + estimatedRemainingDuration) * speed;
              setTotalDuration(totalDurationLocal);
              
              // Keep isEstimated as true during streaming since we don't have final duration yet
              // setIsEstimated(false); // Remove this line - keep it estimated during streaming
              
              console.log(`[Overlay] Streaming progress: processed=${progress.totalProcessed}/${progress.estimatedTotal}, duration=${totalDurationLocal}s`);
            },
            (finalDuration) => {
              // Called when streaming is complete with the final duration
              totalDurationLocal = finalDuration * speed; // Convert to baseline duration
              setTotalDuration(totalDurationLocal);
              setIsEstimated(false); // Now we have the actual final duration
              console.log(`[Overlay] Streaming complete: final duration=${finalDuration}s (real) -> ${totalDurationLocal}s (baseline at ${speed}x)`);
            }
          );

          // After streaming completes, calculate final duration
          console.log(`[Overlay] After processSegmentClientSideStreaming: barStart=${barStart}, nextTime=${nextTime}, audioContext.currentTime=${audioContext.currentTime}`);
          if (barStart > 0 && nextTime && nextTime > barStart) {
            const actualScheduledAudioDuration = nextTime - barStart; // Real seconds
            totalDurationLocal = actualScheduledAudioDuration * speed; // Baseline seconds
            console.log(`[Overlay] Calculated final duration: ${actualScheduledAudioDuration}s (real) -> ${totalDurationLocal}s (baseline at ${speed}x)`);
            setTotalDuration(totalDurationLocal); // Update state for display
            setIsEstimated(false); // Mark as no longer estimated since we have actual duration
          } else {
            console.log(`[Overlay] Could not calculate actual duration, keeping estimated. barStart=${barStart}, nextTime=${nextTime}`);
            // Even if we can't calculate exact duration, we know TTS processing is complete
            setIsEstimated(false);
          }

          await waitForPlaybackCompletion();
        } else { // Handle empty or whitespace-only text
          totalDurationLocal = 0;
          setTotalDuration(0);
          setIsEstimated(false);
          setShowSpinner(false);
          isNewRequest.current = false; // Mark request as handled
        }
      } catch (e) {
        console.error("Error during TTS processing:", e);
        setShowSpinner(false); // Ensure spinner is hidden on error
        setIsPlaying(false);
        setIsPaused(false);
      } finally {
        if (intervalId !== undefined) clearInterval(intervalId);
        if (!cancelled) {
          setElapsed(totalDurationLocal);
          setProgress(text && text.trim().length > 0 ? 100 : 0);
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
