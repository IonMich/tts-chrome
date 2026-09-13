import { normalizeSpeechText } from './speechSegments';
export const READER_CHANNEL = 'local-reader-v2';
export const VOICES = ['af_sarah', 'af_alloy', 'af_nicole', 'am_adam', 'am_michael', 'am_onyx', 'bf_alice', 'bf_lily', 'bm_fable'] as const;
export const MAC_VOICE_PREFIX = 'mac:';
export interface MacVoice { id: string; name: string; language: string; quality?: string; }
export interface VoiceCatalog { macVoices: MacVoice[]; macError?: string; }
export type ReaderPhase = 'idle' | 'installing' | 'preparing' | 'buffering' | 'playing' | 'paused' | 'complete' | 'error';
export interface ReaderRequest { text: string; voice?: string; voiceName?: string; speed?: number; }
export interface ValidatedReaderRequest { text: string; voice: string; voiceName: string; speed: number; }
export interface ReaderLaunchResult { playerShown: boolean; }
export interface ReaderSnapshot {
  phase: ReaderPhase; sessionId?: string; voice: string; voiceName?: string; speed: number;
  elapsedSec: number; durationSec: number | null; bufferedSec: number;
  seekableStartSec?: number; seekableEndSec?: number; replayExpiresAt?: number;
  progress?: number; message?: string; error?: string;
  modelResident?: boolean; generatedChunks?: number; totalChunks?: number;
  pagePlayerAvailable?: boolean;
  speechMode?: 'system';
  revision?: number;
}
export function isCurrentSnapshot(current: ReaderSnapshot, next: ReaderSnapshot) {
  return current.sessionId !== next.sessionId || current.revision === undefined || next.revision === undefined || next.revision >= current.revision;
}
export const idleSnapshot = (): ReaderSnapshot => ({ phase: 'idle', voice: 'af_sarah', speed: 1, elapsedSec: 0, durationSec: null, bufferedSec: 0, modelResident: false });
export const macVoiceValue = (id: string) => `${MAC_VOICE_PREFIX}${id}`;
export const macVoiceId = (voice: unknown) => typeof voice === 'string' && voice.startsWith(MAC_VOICE_PREFIX) ? voice.slice(MAC_VOICE_PREFIX.length) : undefined;
export function validateRequest(request: ReaderRequest): ValidatedReaderRequest {
  const text = typeof request?.text === 'string' ? normalizeSpeechText(request.text) : '';
  if (!text) throw new Error('Select some text, or choose Read page.');
  // Article length does not determine inference or audio-buffer size. The engine
  // generates bounded speech segments and retains only a finite audio window.
  const voice = request.voice ?? 'af_sarah';
  const nativeId = macVoiceId(voice);
  if (!(VOICES as readonly string[]).includes(voice) && nativeId !== 'macos-start-speaking') throw new Error('That voice is not available.');
  const speed = request.speed ?? 1;
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('Choose a speed between 0.5× and 2×.');
  const voiceName = typeof request.voiceName === 'string' && request.voiceName.trim() ? request.voiceName.trim().slice(0, 120) : voice;
  return { text, voice, voiceName, speed };
}
