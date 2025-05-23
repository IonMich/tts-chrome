import React, { useState, useEffect, useRef, useCallback } from "react";
import Overlay from "./Overlay";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import {
  stopSpeech,
  preloadTextClientSide,
  preloadedSegments,
} from "@/lib/ttsClient";
import { Skeleton } from "./skeleton";

interface Request {
  text: string;
  voice: string;
  speed: number;
}

const OverlayManager: React.FC<{ host: HTMLElement }> = ({ host }) => {
  const [queueEnabled, setQueueEnabled] = useState(false);
  const queueEnabledRef = useRef(queueEnabled);
  useEffect(() => {
    queueEnabledRef.current = queueEnabled;
  }, [queueEnabled]);
  const [queue, setQueue] = useState<Request[]>([]);
  const [loadedKeys, setLoadedKeys] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<Request | null>(null);
  const [currentKey, setCurrentKey] = useState(0);
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    chrome.storage.sync.get(["queueEnabled"]).then(({ queueEnabled: qe }) => {
      setQueueEnabled(!!qe);
    });
  }, []);

  useEffect(() => {
    const onStorage = (changes: any, area: string) => {
      if (area === "sync" && changes.queueEnabled) {
        setQueueEnabled(!!changes.queueEnabled.newValue);
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  useEffect(() => {
    const listener = (message: any) => {
      if (message.action === "readText" && message.text) {
        console.log(
          "[OverlayManager] received TTS request:",
          message.text,
          message.voice,
          message.speed
        );
        const req: Request = {
          text: message.text,
          voice: message.voice,
          speed: message.speed,
        };
        if (!currentRef.current) {
          console.log("[OverlayManager] starting immediately:", req.text);
          currentRef.current = req;
          setQueue([]);
          setCurrent(req);
          setCurrentKey((k) => k + 1);
        } else if (queueEnabledRef.current) {
          console.log("[OverlayManager] queuing request:", req.text);
          setQueue((q) => [...q, req]);
        } else {
          console.log(
            "[OverlayManager] replacing current, interrupting playback:",
            req.text
          );
          stopSpeech();
          currentRef.current = null;
          setQueue([]);
          setCurrent(null);
          setTimeout(() => {
            currentRef.current = req;
            setCurrent(req);
            setCurrentKey((k) => k + 1);
          }, 0);
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    queue.forEach((req) => {
      const key = `${req.text}|${req.voice}|${req.speed}|clientside`;
      if (!preloadedSegments[key] && !loadedKeys.has(key)) {
        preloadTextClientSide(req.text, req.voice, req.speed)
          .then(() => setLoadedKeys((prev) => new Set(prev).add(key)))
          .catch(console.error);
      } else if (preloadedSegments[key] && !loadedKeys.has(key)) {
        setLoadedKeys((prev) => new Set(prev).add(key));
      }
    });
  }, [queue, loadedKeys]);

  const handleClose = useCallback(() => {
    console.log(
      "[OverlayManager] onClose called, stopping previous playback and advancing:",
      currentRef.current?.text
    );
    // stop any lingering audio before starting next
    stopSpeech();
    if (queueRef.current.length > 0) {
      const [next, ...rest] = queueRef.current;
      console.log("[OverlayManager] advancing to next in queue:", next.text);
      setQueue(rest);
      currentRef.current = next;
      setCurrent(next);
      setCurrentKey((k) => k + 1);
    } else {
      console.log("[OverlayManager] queue empty, hiding overlay");
      currentRef.current = null;
      setCurrent(null);
    }
  }, []);

  useEffect(() => {
    host.style.display = current ? "" : "none";
  }, [current, host]);

  const removeQueueItem = (index: number) => {
    setQueue((q) => q.filter((_, i) => i !== index));
  };

  if (!current) return null;
  return (
    <>
      <Overlay
        key={currentKey}
        text={current.text}
        voice={current.voice}
        speed={current.speed}
        onClose={handleClose}
      />
      {queueEnabled && queue.length > 0 && (
        <div className="fixed right-4 top-[calc(50%+6rem)] z-[9999] w-36 p-2 bg-card text-card-foreground rounded-md shadow-md">
          <div className="text-sm font-medium mb-1">Queue:</div>
          <div className="scroll-shadows space-y-1 overflow-y-auto max-h-40">
            {queue.map((req, i) => {
              const key = `${req.text}|${req.voice}|${req.speed}`;
              return (
                <div
                  key={i}
                  className="relative text-xs group flex items-center"
                >
                  {!loadedKeys.has(key) && (
                    <Skeleton className="h-4 w-4 mr-1 bg-primary/60" />
                  )}
                  <div className="flex flex-col truncate min-w-0">
                    <p className="truncate">{req.text}</p>
                    <div className="text-muted-foreground ml-1">
                      <span className="text-[10px]">
                        {req.text.trim().split(/\s+/).filter(Boolean).length}{" "}
                        words {req.speed > 0 ? `• ${req.speed}x` : ""}
                        {req.speed > 0 && req.voice ? " • " : ""}
                        {req.voice}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => removeQueueItem(i)}
                    aria-label="Remove from queue"
                    className="absolute top-1/2 right-1 -translate-y-1/2 hover:bg-red-500 hover:text-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                    size="icon"
                    asChild
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
};

export default OverlayManager;
