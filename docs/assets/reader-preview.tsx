// Silent documentation scene. The article and playback position are illustrative;
// the player, source mapping and highlight painter come from the product.
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ReaderPlayer, type PlayerState } from '@/components/reader/ReaderPlayer';
import { captureReadingSource } from '@/lib/sourceText';
import { SourceHighlight } from '@/lib/sourceHighlight';
import './reader-preview.css';

const sentence = 'An ordinary street begins to feel different when you give it your full attention.';
const state: PlayerState = {
  phase: 'playing', elapsedSec: 18, durationSec: null, bufferedSec: 30,
  seekableStartSec: 0, seekableEndSec: 48, voice: 'af_nicole', voiceName: 'Nicole',
  speed: 1, sessionId: 'readme-preview', revision: 1,
};

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
      <header className="site-header"><span className="wordmark">Fieldnotes</span><span className="site-tag">Small observations. A little more attention.</span></header>
      <article>
        <div className="eyebrow">THE EVERYDAY</div>
        <h1>Leave a little room.</h1>
        <p className="standfirst">On taking the long way home.</p>
        <div className="article-body">
          <p>The best part of a walk is often the moment when you stop trying to get somewhere.</p>
          <p>{sentence}</p>
          <p>You notice the light between buildings, a conversation from an open window, the shape of a familiar tree.</p>
        </div>
      </article>
      <div className="player-anchor"><ReaderPlayer state={state} onPause={() => {}} onResume={() => {}} onSeek={() => {}} onSpeed={() => {}} onClose={() => {}} /></div>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Scene />);
