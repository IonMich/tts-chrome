import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, ClipboardPaste, FileText, Keyboard, Play, TextSelect } from 'lucide-react';
import readerIcon from '@/assets/icon.svg';
import { ReaderPlayer } from '@/components/reader/ReaderPlayer';
import { VoicePicker } from '@/components/reader/VoicePicker';
import { changeReaderVoice, pauseReader, seekReader, setReaderSpeed, readCurrentPage, resumeReader, startReader, stopReader, subscribeReader, showReaderPlayer } from '@/lib/readerClient';
import { idleSnapshot, isCurrentSnapshot, macVoiceId, voiceLabel, VOICES, type ReaderSnapshot, type ReaderLaunchResult } from '@/lib/readerProtocol';
import '@/components/reader/reader.css';

const isSavedVoice = (value: unknown): value is string => typeof value === 'string' && ((VOICES as readonly string[]).includes(value) || !!macVoiceId(value));
const isSavedSpeed = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= .5 && value <= 2;

export default function App() {
  const [snapshot, setSnapshot] = useState<ReaderSnapshot>(idleSnapshot);
  const snapshotRef = useRef(snapshot);
  const [voice, setVoice] = useState<string>('af_sarah');
  const [speed, setSpeed] = useState(1);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [voicePending, setVoicePending] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const acceptSnapshot = (next: ReaderSnapshot) => {
    if (!isCurrentSnapshot(snapshotRef.current, next)) return;
    snapshotRef.current = next;
    setSnapshot(next);
    if (next.phase !== 'idle') {
      setVoice(next.voice);
      setSpeed(next.speed);
    }
  };
  useEffect(() => {
    let mounted = true;
    let voiceUpdated = false;
    let speedUpdated = false;
    const unsubscribe = subscribeReader(acceptSnapshot);
    const settingsChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (!mounted || area !== 'sync') return;
      if (isSavedVoice(changes.voice?.newValue)) { voiceUpdated = true; setVoice(changes.voice.newValue); }
      if (isSavedSpeed(changes.speed?.newValue)) { speedUpdated = true; setSpeed(changes.speed.newValue); }
    };
    chrome.storage.onChanged.addListener(settingsChanged);
    void chrome.commands.getAll().then(commands => {
      if (mounted) setShortcuts(Object.fromEntries(commands.map(command => [command.name ?? '', command.shortcut || 'Not assigned'])));
    }).catch(() => { if (mounted) setShortcuts({ trigger_tts: 'Unavailable', trigger_page_tts: 'Unavailable' }); });
    void chrome.storage.sync.get(['voice', 'speed']).then(settings => {
      if (!mounted) return;
      if (snapshotRef.current.phase === 'idle') {
        if (!voiceUpdated && isSavedVoice(settings.voice)) setVoice(settings.voice);
        if (!speedUpdated && isSavedSpeed(settings.speed)) setSpeed(settings.speed);
      }
      setSettingsReady(true);
    }).catch(() => { if (mounted) setSettingsReady(true); });
    return () => { mounted = false; unsubscribe(); chrome.storage.onChanged.removeListener(settingsChanged); };
  }, []);
  const hasReading = snapshot.phase !== 'idle';
  const readingVoice = hasReading ? snapshot.voice : voice;
  const readingSpeed = hasReading ? snapshot.speed : speed;
  const run = async (command: () => Promise<void>) => {
    setError(''); setPending(true);
    try { await command(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setPending(false); }
  };
  const readPage = (selectionOnly: boolean) => run(async () => {
    await chrome.storage.sync.set({ voice: readingVoice, voiceName: voiceLabel(readingVoice), speed: readingSpeed });
    finishLaunch(await readCurrentPage(selectionOnly));
  });
  const control = async (command: () => Promise<ReaderSnapshot | undefined>) => {
    const sessionId = snapshotRef.current.sessionId;
    try {
      const next = await command();
      if (next && snapshotRef.current.sessionId === sessionId) acceptSnapshot(next);
      return next;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      throw failure;
    }
  };
  const changeVoice = async (nextVoice: string) => {
    const current = snapshotRef.current;
    setVoicePending(true);
    try {
      const next = await changeReaderVoice(nextVoice, current.phase !== 'idle' ? current.sessionId : undefined);
      if (next && snapshotRef.current.sessionId === current.sessionId) acceptSnapshot(next);
      setVoice(snapshotRef.current.phase !== 'idle' ? snapshotRef.current.voice : nextVoice);
      return next;
    } finally { setVoicePending(false); }
  };
  const finishLaunch = (result: ReaderLaunchResult) => {
    // Closing a popup does not stop the background-owned session. Keep it open
    // when Chrome prevents an in-page player, so fallback controls stay usable.
    if (result.playerShown) window.close();
  };
  const canStart = settingsReady && !pending && !voicePending;
  return <main className="reader-menu">
    <header className="reader-menu__header">
      <img src={readerIcon} width={36} height={36} alt="" />
      <h1>Local Reader</h1>
    </header>
    {hasReading && <section className="reader-menu__session" aria-label="Current reading">
      <ReaderPlayer state={snapshot} onPause={() => control(()=>pauseReader(snapshot.sessionId))} onResume={() => control(()=>resumeReader(snapshot.sessionId))} onClose={() => void run(stopReader)} onSeek={s=>control(()=>seekReader(s,snapshot.sessionId))} onSpeed={s=>void run(()=>setReaderSpeed(s))} onVoice={changeVoice} />
      {snapshot.pagePlayerAvailable !== false && <button className="reader-menu__link" disabled={pending} onClick={() => void run(async () => finishLaunch(await showReaderPlayer()))}>Show page player<ArrowUpRight size={15} aria-hidden="true" /></button>}
    </section>}
    <div className="reader-menu__actions">
      <button className="reader-menu__primary" disabled={!canStart} onClick={() => void readPage(true)}><TextSelect size={20} aria-hidden="true" /><span>Read selected text</span><Play className="reader-menu__action-end" size={15} fill="currentColor" aria-hidden="true" /></button>
      <button className="reader-menu__secondary" disabled={!canStart} onClick={() => void readPage(false)}><FileText size={19} aria-hidden="true" /><span>Read this page</span><ArrowUpRight className="reader-menu__action-end" size={17} aria-hidden="true" /></button>
    </div>
    {!hasReading && <div className={`reader-menu__fields${macVoiceId(voice)?' reader-menu__fields--voice-only':''}`}>
      <div className="reader-menu__field"><VoicePicker value={voice} onChange={changeVoice} disabled={!settingsReady || pending || voicePending} compact label="Voice" /></div>
      {!macVoiceId(voice)&&<div className="reader-menu__field"><label htmlFor="reader-speed">Speed</label><div className="reader-menu__select"><select id="reader-speed" value={speed} disabled={!settingsReady} onChange={event => {
        const next = Number(event.target.value); setSpeed(next); void chrome.storage.sync.set({ speed: next }).catch(() => setError('Could not save the selected speed.'));
      }}>{[.5,.75,1,1.25,1.5,1.75,2].map(value => <option key={value} value={value}>{value}×</option>)}</select><ChevronDown size={14} aria-hidden="true" /></div></div>}
    </div>}
    <details><summary><ClipboardPaste size={17} aria-hidden="true" /><span>Paste text</span><ChevronDown className="reader-menu__chevron" size={15} aria-hidden="true" /></summary>
      <div className="reader-menu__disclosure"><label className="reader-sr" htmlFor="reader-text">Text</label><textarea id="reader-text" value={text} onChange={event => setText(event.target.value)} placeholder="Paste text…" />
      <button className="reader-menu__primary reader-menu__read-text" disabled={!canStart || !text.trim()} onClick={() => void run(async () => finishLaunch(await startReader({ text, voice: readingVoice, speed: readingSpeed })))}><Play size={15} fill="currentColor" aria-hidden="true" /><span>Read this text</span></button></div>
    </details>
    <details><summary><Keyboard size={17} aria-hidden="true" /><span>Keyboard shortcuts</span><ChevronDown className="reader-menu__chevron" size={15} aria-hidden="true" /></summary>
      <div className="reader-menu__disclosure"><dl className="reader-menu__shortcuts"><dt>Selected text</dt><dd><kbd>{shortcuts.trigger_tts ?? 'Checking…'}</kbd></dd><dt>Current page</dt><dd><kbd>{shortcuts.trigger_page_tts ?? 'Checking…'}</kbd></dd></dl>
      <button className="reader-menu__link" disabled={pending} onClick={() => void run(async () => { await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); })}>Customize shortcuts<ArrowUpRight size={15} aria-hidden="true" /></button></div>
    </details>
    {error && <p role="alert" className="reader-menu__error">{error}</p>}
    {pending && <p className="reader-menu__notice" role="status">Working…</p>}
  </main>;
}
