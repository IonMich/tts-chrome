// Silent documentation scene. A brief attributed excerpt uses an illustrative
// playback position; the player, source mapping and painter come from the product.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReaderPlayer, type PlayerState } from '@/components/reader/ReaderPlayer';
import { captureReadingSource } from '@/lib/sourceText';
import { SourceHighlight } from '@/lib/sourceHighlight';
import App from '@/entrypoints/popup/App';
import { idleSnapshot, voiceLabel } from '@/lib/readerProtocol';
import './reader-preview.css';

const sentence = 'I think that most people are underestimating just how radical the upside of AI could be,';
const articleUrl = 'https://darioamodei.com/essay/machines-of-loving-grace';
const state: PlayerState = {
  phase: 'playing', elapsedSec: 18, durationSec: null, bufferedSec: 30,
  seekableStartSec: 0, seekableEndSec: 48, voice: 'af_nicole', voiceName: 'Nicole',
  speed: 1, sessionId: 'readme-preview', revision: 1,
};

// Documentation-only Chrome adapter: fixed settings, no audio or native host.
const preferences = { voice: 'af_nicole', speed: 1 };
Object.assign(window, { chrome: {
  runtime: {
    onMessage: { addListener() {}, removeListener() {} },
    async sendMessage(message: { action: string; voice?: string }) {
      if (message.action === 'native-list') return { macVoices: [{ id: 'macos-start-speaking', name: 'Mac voice', language: 'en-US' }] };
      if (message.action === 'voice' && message.voice) preferences.voice = message.voice;
      return { snapshot: { ...idleSnapshot(), ...preferences, voiceName: voiceLabel(preferences.voice) } };
    },
  },
  storage: {
    onChanged: { addListener() {}, removeListener() {} },
    sync: { async get() { return preferences; }, async set(values: object) { Object.assign(preferences, values); } },
  },
  commands: { async getAll() { return [{ name: 'trigger_tts', shortcut: '⌘⇧S' }, { name: 'trigger_page_tts', shortcut: '⌘⇧P' }]; } },
} });

function PlayerPreview() {
  const [current, setCurrent] = useState(state);
  return <ReaderPlayer state={current}
    onPause={() => setCurrent(value => ({ ...value, phase: 'paused' }))}
    onResume={() => setCurrent(value => ({ ...value, phase: 'playing' }))}
    onSeek={() => {}} onSpeed={() => {}} onClose={() => {}}
    onVoice={voice => setCurrent(value => ({ ...value, voice, voiceName: voiceLabel(voice) }))} />;
}

function Scene() {
  useEffect(() => {
    const source = captureReadingSource(document, false, 'readme-article');
    const start = source.text.indexOf(sentence);
    if (start < 0) throw new Error('Illustrated sentence is missing');
    const painter = new SourceHighlight(document);
    painter.prepare(source, state.sessionId!);
    painter.observe({ ...state, sourceId: source.sourceId,
      spokenPosition: { precision: 'sentence', start, end: start + sentence.length } });
    document.documentElement.dataset.ready = 'true';
    return () => painter.dispose();
  }, []);
  return <main className="scene">
    <div className="paper">
      <header className="site-header"><a href={articleUrl} className="source-domain">darioamodei.com</a><span className="source-label">EXCERPT</span></header>
      <article>
        <h1>Machines of<br />Loving Grace</h1>
        <p className="byline">Dario Amodei</p>
        <div className="article-body">
          <p>{sentence} …</p>
        </div>
      </article>
      <div className="player-anchor"><PlayerPreview /></div>
    </div>
  </main>;
}
const view = new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')!).render(view === 'popup'
  ? <div className="popup-preview"><App /></div>
  : view === 'voices' ? <div className="voice-preview"><PlayerPreview /></div> : <Scene />);
