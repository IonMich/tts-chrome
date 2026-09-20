import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AudioLines, LoaderCircle, Pause, Play, RotateCcw, RotateCw, Square, X } from 'lucide-react';
import { ReaderScrubber, type ScrubCommandResult, type ScrubView } from '@/lib/readerScrubber';
import { VoicePicker } from '@/components/reader/VoicePicker';
import type { SpokenPosition } from '@/lib/speechPosition';
import './reader.css';

export type PlayerPhase = 'idle' | 'installing' | 'preparing' | 'buffering' | 'playing' | 'paused' | 'complete' | 'error';
export interface PlayerState {
  phase: PlayerPhase;
  elapsedSec: number;
  durationSec: number | null;
  bufferedSec: number;
  seekableStartSec?: number;
  seekableEndSec?: number;
  replayExpiresAt?: number;
  progress?: number;
  message?: string;
  error?: string;
  voice: string;
  voiceName?: string;
  speed: number;
  speechMode?: 'system';
  stopping?: boolean;
  stopReason?: 'user';
  spokenPosition?: SpokenPosition;
  sessionId?: string;
  revision?: number;
}
type PlayerCommand = () => ScrubCommandResult | Promise<ScrubCommandResult>;
export interface ReaderPlayerProps {
  state: PlayerState;
  onPause: PlayerCommand;
  onResume: PlayerCommand;
  onClose: () => void;
  onSeek?: (seconds: number) => ScrubCommandResult | Promise<ScrubCommandResult>;
  onSpeed?: (speed: number) => void;
  onVoice?: (voice: string) => ScrubCommandResult | Promise<ScrubCommandResult>;
  onReplay?: () => void;
  floating?: boolean;
}

const labels: Record<PlayerPhase, string> = {
  idle: 'Ready to read',
  installing: 'Loading voice',
  preparing: 'Preparing speech',
  buffering: 'Loading audio',
  playing: 'Reading aloud',
  paused: 'Paused',
  complete: 'Finished reading',
  error: 'Reading interrupted',
};

export function formatReaderTime(seconds: number) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ReaderPlayer({ state, onPause, onResume, onClose, onSeek, onSpeed, onVoice, onReplay, floating = false }: ReaderPlayerProps) {
  const [preview, setPreview] = useState<ScrubView | null>(null);
  const [voicePending, setVoicePending] = useState(false);
  const scrubber = useRef<ReaderScrubber | null>(null);
  scrubber.current ??= new ReaderScrubber(state, { pause: onPause, resume: onResume, seek: seconds => onSeek?.(seconds) }, setPreview);
  const scrub = scrubber.current;
  scrub.commands = { pause: onPause, resume: onResume, seek: seconds => onSeek?.(seconds) };
  useEffect(() => { scrub.activate(); return () => scrub.dispose(); }, [scrub]);
  useEffect(() => scrub.observe(state), [scrub, state]);

  const system = state.speechMode === 'system';
  const start = Math.max(0, state.seekableStartSec ?? 0);
  const end = Math.max(start, state.seekableEndSec ?? 0);
  const known = Number.isFinite(state.durationSec) && (state.durationSec ?? 0) > 0;
  const seekable = !system && !!onSeek && end > start + .02;
  const shown = preview?.seconds ?? state.elapsedSec;
  const min = preview?.start ?? start;
  const max = preview?.end ?? end;
  const active = ['playing', 'buffering'].includes(state.phase);
  const resume = state.phase === 'paused';
  const replay = state.phase === 'complete' && (system || seekable);
  const busy = ['preparing', 'installing', 'buffering'].includes(state.phase);
  const fraction = max > min ? Math.max(0, Math.min(100, (shown - min) / (max - min) * 100)) : 0;
  const seek = (value: number) => scrub.seek(value);
  const control = (action: PlayerCommand) => { void Promise.resolve().then(action).catch(() => {}); };
  const changeVoice = async (voice: string) => {
    if (!onVoice || voicePending || voice === state.voice) return;
    setVoicePending(true);
    try { await onVoice(voice); }
    finally { setVoicePending(false); }
  };
  const stopped = system && state.phase === 'complete' && state.stopReason === 'user';
  const title = system && state.stopping ? 'Stopping…' : stopped ? 'Stopped' : labels[state.phase];

  const heading = (
    <div className="reader-player__heading">
      <AudioLines className="reader-player__status-icon" size={15} aria-hidden="true" />
      <span className="reader-player__title" role="status" aria-live="polite">{title}</span>
      <button className="reader-player__icon" aria-label="Close player and stop reading" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
  const identity = (
    <div className="reader-player__identity">
      <VoicePicker value={state.voice} onChange={changeVoice} disabled={!onVoice || !state.sessionId || voicePending || !!preview || !!state.stopping} active={!['idle', 'complete', 'error'].includes(state.phase)} />
    </div>
  );
  const error = state.phase === 'error' && (
    <div className="reader-player__details">
      <p role="alert" className="reader-player__error">{state.error || 'Reading could not continue.'}</p>
    </div>
  );

  if (system) {
    const canStop = ['preparing', 'installing', 'buffering', 'playing'].includes(state.phase);
    return (
      <section className={`reader-player reader-player--system${floating ? ' reader-player--floating' : ''}`} aria-label="Reading player" data-phase={state.phase}>
        {heading}
        {identity}
        <div className="reader-player__native">
          {canStop ? (
            <button className="reader-player__native-action" disabled={voicePending || state.stopping} onClick={() => control(onPause)}>
              {state.stopping ? <LoaderCircle className="reader-spin" size={16} aria-hidden="true" /> : <Square size={13} fill="currentColor" aria-hidden="true" />}
              {state.stopping ? 'Stopping…' : 'Stop reading'}
            </button>
          ) : state.phase === 'paused' ? (
            <button className="reader-player__native-action" disabled={voicePending} onClick={() => control(onResume)}>
              <Play size={16} fill="currentColor" aria-hidden="true" />Resume reading
            </button>
          ) : state.phase === 'complete' ? (
            <button className="reader-player__native-action" aria-label="Replay from beginning" disabled={voicePending} onClick={() => control(onResume)}>
              <RotateCcw size={17} aria-hidden="true" />Replay
            </button>
          ) : null}
        </div>
        {error}
      </section>
    );
  }

  const rangeStart = seekable && min > 0 ? `From ${formatReaderTime(min)}` : '';
  const replayStatus = state.replayExpiresAt
    ? `Replay for ${formatReaderTime((state.replayExpiresAt - Date.now()) / 1000)}`
    : state.phase === 'complete' && !seekable ? 'Replay unavailable' : '';

  return (
    <section className={`reader-player${floating ? ' reader-player--floating' : ''}`} aria-label="Reading player" data-phase={state.phase}>
      {heading}
      {identity}
      <div className="reader-player__controls">
        <div className="reader-player__transport">
          <button className="reader-player__skip" aria-label="Back 15 seconds" title="Back 15 seconds" disabled={voicePending || !seekable || !!preview?.dragging || shown <= start + .01} onClick={() => seek(shown - 15)}>
            <RotateCcw size={25} aria-hidden="true" /><span aria-hidden="true">15</span>
          </button>
          <button
            className="reader-player__main"
            aria-label={replay ? 'Replay available audio' : active ? 'Pause reading' : resume ? 'Resume reading' : labels[state.phase]}
            disabled={voicePending || !!preview || !active && !resume && !replay && !onReplay}
            onClick={() => {
              if (active) control(onPause);
              else if (resume) control(onResume);
              else if (replay) control(onResume);
              else onReplay?.();
            }}
          >
            {active ? <Pause size={21} fill="currentColor" aria-hidden="true" />
              : resume || replay ? <Play size={21} fill="currentColor" aria-hidden="true" />
                : busy ? <LoaderCircle className="reader-spin" size={23} aria-hidden="true" />
                  : <AudioLines size={23} aria-hidden="true" />}
          </button>
          <button className="reader-player__skip" aria-label="Forward 15 seconds" title="Forward 15 seconds" disabled={voicePending || !seekable || !!preview?.dragging || shown >= end - .01} onClick={() => seek(shown + 15)}>
            <RotateCw size={25} aria-hidden="true" /><span aria-hidden="true">15</span>
          </button>
        </div>
        <label className="reader-player__speed">
          <span className="reader-sr">Playback speed</span>
          <select aria-label="Playback speed" value={state.speed} disabled={voicePending || !onSpeed} onChange={event => onSpeed?.(Number(event.target.value))}>
            {[.5, .75, 1, 1.25, 1.5, 1.75, 2].map(value => <option key={value} value={value}>{value}×</option>)}
          </select>
        </label>
      </div>
      <div className="reader-player__timeline">
        <input
          type="range"
          className="reader-player__seek"
          aria-label="Seek in available audio"
          aria-valuetext={`${formatReaderTime(shown)}; available ${formatReaderTime(min)} to ${formatReaderTime(max)}${known ? '' : '; final duration not known'}`}
          min={min}
          max={Math.max(min + .01, max)}
          step={.1}
          value={Math.max(min, Math.min(max, shown))}
          disabled={voicePending || !seekable}
          style={{ '--reader-position': `${fraction}%`, touchAction: 'none' } as CSSProperties}
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            scrub.begin(event.pointerId);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onChange={event => {
            const value = Number(event.target.value);
            if (scrub.pointerId !== null) scrub.move(value);
            else seek(value);
          }}
          onPointerUp={event => {
            scrub.end(event.pointerId, Number(event.currentTarget.value));
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={event => scrub.cancel(event.pointerId)}
          onLostPointerCapture={event => scrub.cancel(event.pointerId)}
          onBlur={() => { if (scrub.pointerId !== null) scrub.cancel(scrub.pointerId); }}
        />
        <div className="reader-player__range">
          <time className="reader-player__time">{formatReaderTime(shown)}</time>
          <span>
            {known ? <time>{formatReaderTime(state.durationSec!)}</time>
              : seekable ? <>Available to <time>{formatReaderTime(max)}</time></>
                : state.phase === 'installing' && state.progress !== undefined ? <span role="status">{Math.round(state.progress)}%</span>
                  : null}
          </span>
        </div>
        {(rangeStart || replayStatus) && (
          <div className="reader-player__availability">
            <span>{rangeStart}</span><span>{replayStatus}</span>
          </div>
        )}
      </div>
      {error}
    </section>
  );
}
