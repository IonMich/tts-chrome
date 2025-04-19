import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import Loader from '@/components/ui/Loader';
import { Play, Pause, StopCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { splitTextForHybrid } from '@/lib/utilsText';
import {
  processSegment,
  stopSpeech,
  reset,
  waitForPlaybackCompletion,
  setCurrentVoice,
  audioContext,
  nextTime,
} from '@/lib/ttsClient';

interface OverlayProps {
  text: string;
  voice: string;
  onClose: () => void;
}

const estimateDuration = (text: string) => text.length / 15;

const Overlay: React.FC<OverlayProps> = ({ text, voice, onClose }) => {
  // detect each unique text|voice request during render
  const reqKey = text + '|' + voice;
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
  // show loader for new requests or when spinner flag is true
  const shouldShowLoader = isNewRequest.current || showSpinner;

  // reset spinner and progress before paint on every new text/voice
  useLayoutEffect(() => {
    setProgressKey(k => k + 1);
    setProgress(0);
    setShowSpinner(true);
  }, [text, voice, onClose]);

  useEffect(() => {
    // start TTS processing
    let cancelled = false;
    setCurrentVoice(voice);
    reset();

    const { firstSegment, secondSegment } = splitTextForHybrid(text, 15, 3);
    let totalDuration = estimateDuration(text);
    let barStart = 0;
    let intervalId: number | undefined;

    const onFirstChunk = () => {
      isNewRequest.current = false;
      setShowSpinner(false);
      barStart = audioContext.currentTime;
      intervalId = window.setInterval(() => {
        const elapsed = audioContext.currentTime - barStart;
        const pct = Math.min(100, (elapsed / totalDuration) * 100);
        setProgress(pct);
      }, 100);
    };

    (async () => {
      setIsPlaying(true);
      try {
        await processSegment(firstSegment, onFirstChunk);
        const firstActual = nextTime! - barStart;
        totalDuration = firstActual + (secondSegment ? estimateDuration(secondSegment) : 0);
        if (secondSegment) await processSegment(secondSegment);
        totalDuration = nextTime! - barStart;
        await waitForPlaybackCompletion();
      } catch (e) {
        console.error(e);
      } finally {
        if (intervalId !== undefined) clearInterval(intervalId);
        if (!cancelled) {
          setIsPlaying(false);
          setIsPaused(false);
          setShowSpinner(false);
          setProgress(100);
          // hide overlay after natural completion
          onClose();
        }
      }
    })();

    return () => {
      cancelled = true;
      if (intervalId !== undefined) clearInterval(intervalId);
      stopSpeech();
    };
  }, [text, voice, onClose]);

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
    <div className={cn('fixed right-4 top-1/2 transform -translate-y-1/2 z-[9999]')}>
      <Card className="w-36 p-4 space-y-4">
        {shouldShowLoader ? (
          <Loader className="h-8 w-8 mx-auto my-1" />
        ) : (
          <Progress
            key={progressKey}
            value={progress}
            className="w-28 my-4"
          />
        )}
        <div className="flex justify-center space-x-2">
          <Button size="sm" onClick={handleToggle} disabled={!isPlaying}>
            {isPaused || !isPlaying ? <Play size={16} /> : <Pause size={16} />}
          </Button>
          <Button variant="destructive" size="sm" onClick={handleStop} disabled={!isPlaying}>
            <StopCircle size={16} />
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default Overlay;