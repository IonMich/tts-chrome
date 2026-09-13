import { useEffect, useState } from 'react';
import { ReaderPlayer } from '@/components/reader/ReaderPlayer';
import { getVoiceCatalog, pauseReader, seekReader, setReaderSpeed, readCurrentPage, resumeReader, startReader, stopReader, subscribeReader, showReaderPlayer } from '@/lib/readerClient';
import { idleSnapshot, isCurrentSnapshot, macVoiceId, macVoiceValue, VOICES, type MacVoice, type ReaderSnapshot, type ReaderLaunchResult, type ReaderPhase } from '@/lib/readerProtocol';
import '@/components/reader/reader.css';

const voiceLabel = (voice: string) => `${voice.slice(3).replace(/^./, s => s.toUpperCase())} · ${voice[0] === 'b' ? 'British' : 'American'}`;
const phaseLabel: Record<ReaderPhase, string> = { idle: 'Ready to read', installing: 'Setting up voice', preparing: 'Preparing speech', buffering: 'Buffering', playing: 'Reading aloud', paused: 'Paused', complete: 'Finished reading', error: 'Reading interrupted' };

export default function App() {
  const [snapshot, setSnapshot] = useState<ReaderSnapshot>(idleSnapshot);
  const [voice, setVoice] = useState<string>('af_sarah');
  const [speed, setSpeed] = useState(1);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [macVoices, setMacVoices] = useState<MacVoice[]>([]);
  const [macError, setMacError] = useState('');
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeReader(next => setSnapshot(current => isCurrentSnapshot(current, next) ? next : current));
    void chrome.commands.getAll().then(commands => {
      if (mounted) setShortcuts(Object.fromEntries(commands.map(command => [command.name ?? '', command.shortcut || 'Not assigned'])));
    }).catch(() => { if (mounted) setShortcuts({ trigger_tts: 'Unavailable', trigger_page_tts: 'Unavailable' }); });
    void Promise.all([chrome.storage.sync.get(['voice', 'speed']), getVoiceCatalog()]).then(([settings, catalog]) => {
      if (!mounted) return;
      setMacVoices(catalog.macVoices); setMacError(catalog.macError ?? '');
      if ((VOICES as readonly string[]).includes(settings.voice) || typeof macVoiceId(settings.voice) === 'string') setVoice(settings.voice);
      if (Number.isFinite(settings.speed) && settings.speed >= .5 && settings.speed <= 2) setSpeed(settings.speed);
      setSettingsReady(true);
    }).catch(() => { if (mounted) setSettingsReady(true); });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  const selectedVoiceName = () => {
    const nativeId = macVoiceId(voice);
    return nativeId ? macVoices.find(candidate => candidate.id === nativeId)?.name ?? 'Mac voice' : voiceLabel(voice);
  };
  const run = async (command: () => Promise<void>) => {
    setError(''); setPending(true);
    try { await command(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setPending(false); }
  };
  const readPage = (selectionOnly: boolean) => run(async () => {
    await chrome.storage.sync.set({ voice, voiceName: selectedVoiceName(), speed });
    finishLaunch(await readCurrentPage(selectionOnly));
  });
  const control = async (command: () => Promise<ReaderSnapshot | undefined>) => {
    const sessionId = snapshot.sessionId;
    try {
      const next = await command();
      if (next) setSnapshot(current => current.sessionId === sessionId && isCurrentSnapshot(current, next) ? next : current);
      return next;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      throw failure;
    }
  };
  const finishLaunch = (result: ReaderLaunchResult) => {
    // Closing a popup does not stop the background-owned session. Keep it open
    // when Chrome prevents an in-page player, so fallback controls stay usable.
    if (result.playerShown) window.close();
  };
  const canStart = settingsReady && !pending;
  return <main className="reader-menu">
    <h1>Read aloud</h1>
    <p className="reader-menu__intro">A small player, only when you ask for it.</p>
    {snapshot.phase !== 'idle' && <section className="reader-menu__session" aria-label="Current reading">
      {snapshot.pagePlayerAvailable === false ? <>
        <p className="reader-menu__small">This page does not allow an in-page player. Control this reading here.</p>
        <ReaderPlayer state={snapshot} onPause={() => control(()=>pauseReader(snapshot.sessionId))} onResume={() => control(()=>resumeReader(snapshot.sessionId))} onClose={() => void run(stopReader)} onSeek={s=>control(()=>seekReader(s,snapshot.sessionId))} onSpeed={s=>void run(()=>setReaderSpeed(s))} />
      </> : <>
        <p className="reader-menu__session-status" role="status">{phaseLabel[snapshot.phase]}</p>
        <p className="reader-menu__small">Playback controls are on the reading page.</p>
        <div className="reader-menu__session-actions">
          <button className="reader-menu__secondary" disabled={pending} onClick={() => void run(async () => finishLaunch(await showReaderPlayer()))}>Show page player</button>
          <button className="reader-menu__secondary" disabled={pending} onClick={() => void run(stopReader)}>Stop</button>
        </div>
        {snapshot.error && <p className="reader-menu__error" role="alert">{snapshot.error}</p>}
      </>}
    </section>}
    <button className="reader-menu__primary" disabled={!canStart} onClick={() => void readPage(true)}>Read selected text</button>
    <button className="reader-menu__secondary" disabled={!canStart} onClick={() => void readPage(false)}>Read this page</button>
    <div className={`reader-menu__fields${macVoiceId(voice)?' reader-menu__fields--voice-only':''}`}>
      <div><label htmlFor="reader-voice">Voice</label><select id="reader-voice" value={voice} disabled={!settingsReady} onChange={event => {
        const next = event.target.value; setVoice(next); void chrome.storage.sync.set({ voice: next }).catch(() => setError('Could not save the selected voice.'));
      }}><optgroup label="Mac voices">{macVoices.map(value => <option key={value.id} value={macVoiceValue(value.id)}>{value.name}</option>)}{!macVoices.length&&<option disabled value="mac:unavailable">{macError?'Unavailable':'No voices found'}</option>}{macVoiceId(voice)&&!macVoices.some(value=>macVoiceValue(value.id)===voice)&&<option disabled value={voice}>Unavailable Mac voice</option>}</optgroup><optgroup label="Kokoro">{VOICES.map(value => <option key={value} value={value}>{voiceLabel(value)}</option>)}</optgroup></select></div>
      {!macVoiceId(voice)&&<div><label htmlFor="reader-speed">Speed</label><select id="reader-speed" value={speed} disabled={!settingsReady} onChange={event => {
        const next = Number(event.target.value); setSpeed(next); void chrome.storage.sync.set({ speed: next }).catch(() => setError('Could not save the selected speed.'));
      }}>{[.5,.75,1,1.25,1.5,1.75,2].map(value => <option key={value} value={value}>{value}×</option>)}</select></div>}
    </div>
    <p className="reader-menu__small">{macVoiceId(voice)?'The Mac voice uses the Start Speaking setting.':'Voice and speed apply to your next reading.'}</p>
    <details><summary>Or paste text to read</summary>
      <label htmlFor="reader-text">Text</label><textarea id="reader-text" value={text} onChange={event => setText(event.target.value)} placeholder="Paste the passage you want to hear…" />
      <button className="reader-menu__secondary" disabled={!canStart || !text.trim()} onClick={() => void run(async () => finishLaunch(await startReader({ text, voice, voiceName: selectedVoiceName(), speed })))}>Read this text</button>
    </details>
    <details><summary>Keyboard shortcuts</summary>
      <dl className="reader-menu__shortcuts"><dt>Selected text</dt><dd>{shortcuts.trigger_tts ?? 'Checking…'}</dd><dt>Current page</dt><dd>{shortcuts.trigger_page_tts ?? 'Checking…'}</dd></dl>
      <p className="reader-menu__small">Chrome manages shortcut conflicts. To choose an unused shortcut, open <code>chrome://extensions/shortcuts</code>. Existing assignments stay unchanged.</p>
    </details>
    {error && <p role="alert" className="reader-menu__error">{error}</p>}
    {pending && <p className="reader-menu__notice" role="status">Sending your request…</p>}
    <p className="reader-menu__notice">Speech runs locally. Close the player to stop and release its resources.</p>
  </main>;
}
