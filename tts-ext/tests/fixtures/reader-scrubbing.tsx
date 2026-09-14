import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReaderPlayer, type PlayerState } from '@/components/reader/ReaderPlayer';
import { NativeAudioStream } from '@/lib/nativeAudioStream';
import { isCurrentSnapshot } from '@/lib/readerProtocol';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let stream: NativeAudioStream, context: AudioContext, emit: () => PlayerState;
let revision = 0, executeDelay = 70, ackDelay = 140, rangeOverride: { start: number; end: number } | undefined;
let expired = false, activeCommands = 0, maximumActiveCommands = 0;
const events: any[] = [];
function App() {
  const [ready, setReady] = useState(false), [visible, setVisible] = useState(true);
  const [state, setState] = useState<PlayerState>({ phase: 'paused', elapsedSec: 0, durationSec: 90, bufferedSec: 0, voice: 'af_sarah', speed: 1, sessionId: 'native-fixture', revision: 0 });
  const capture = (): PlayerState => ({ phase: expired ? 'complete' : stream.audio.paused ? 'paused' : 'playing', elapsedSec: stream.position, durationSec: 90, bufferedSec: stream.ahead, seekableStartSec: expired ? 0 : rangeOverride?.start ?? stream.start, seekableEndSec: expired ? 0 : rangeOverride?.end ?? stream.end, voice: 'af_sarah', speed: 1, sessionId: 'native-fixture', revision: ++revision });
  emit = () => { const next = capture(); setState(current => isCurrentSnapshot(current, next) ? next : current); return next; };
  const control = async (kind: string, seconds?: number) => {
    activeCommands++; maximumActiveCommands = Math.max(maximumActiveCommands, activeCommands);
    events.push({ event: 'start', kind, seconds, at: performance.now(), position: stream.position });
    try {
      await sleep(executeDelay);
      if (kind === 'pause') { stream.pause(); await context.suspend(); }
      if (kind === 'seek') stream.seek(seconds!);
      if (kind === 'resume') await stream.play();
      const result = emit();
      await sleep(ackDelay);
      setState(current => isCurrentSnapshot(current, result) ? result : current);
      events.push({ event: 'ack', kind, seconds, at: performance.now(), position: stream.position });
      return result;
    } finally { activeCommands--; }
  };
  const boot = async () => {
    context = new AudioContext({ sampleRate: 24000 });
    stream = new NativeAudioStream(context, context.destination, () => { if (ready) emit(); }, error => { throw error; });
    await stream.open();
    for (let chunk = 0; chunk < 15; chunk++) {
      const samples = Float32Array.from({ length: 144000 }, (_, i) => .015 * Math.sin(2 * Math.PI * 660 * i / 24000));
      await stream.append(samples, 24000);
    }
    await stream.finish(); await context.suspend(); setReady(true); emit();
    setInterval(() => { if (!expired) emit(); }, 40);
    Object.assign(window, { scrubHarness: {
      events, inspect: () => ({ position: stream.position, paused: stream.audio.paused, context: context.state, activeCommands, maximumActiveCommands, expired, revision }),
      range: (start: number, end: number) => { rangeOverride = { start, end }; emit(); },
      resetRange: () => { rangeOverride = undefined; emit(); },
      delays: (execute: number, ack: number) => { executeDelay = execute; ackDelay = ack; },
      expire: () => { expired = true; stream.close(); void context.close(); emit(); },
      stale: () => setState(current => isCurrentSnapshot(current, { ...current, elapsedSec: 0, revision: 1 }) ? { ...current, elapsedSec: 0, revision: 1 } : current),
    } });
  };
  return <main><h1>Native audio scrubbing regression</h1><p>Production player and native Opus/WebM stream, generated test tone, delayed control acknowledgments; no speech model.</p>
    {!ready ? <button onClick={() => void boot()}>Prepare native audio</button> : visible ? <ReaderPlayer state={state} onPause={() => control('pause')} onResume={() => control('resume')} onSeek={seconds => control('seek', seconds)} onClose={() => { expired = true; stream.close(); void context.close(); setVisible(false); }} /> : <p>Closed</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
