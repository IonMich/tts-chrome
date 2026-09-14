import { splitSpeech } from './speechSegments';

/** UTF-16 offsets into the normalized request text, never into the DOM or PCM. */
export type SpokenPosition =
  | { precision: 'unavailable' }
  | { precision: 'sentence' | 'chunk'; start: number; end: number };
export interface SourceSentence { id: string; start: number; end: number; }
export interface SourceChunk { text: string; start: number; end: number; }
export interface SpeechCue extends SourceChunk { audioStart: number; audioEnd: number; }

const abbreviation = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z]|\b(?:[A-Za-z]\.)+[A-Za-z])\.$/i;

/** Deterministic on both sides of the extension boundary; blocks are sentences too. */
export function sourceSentences(text: string): SourceSentence[] {
  const sentences: SourceSentence[] = [];
  let start = 0;
  const add = (end: number) => {
    while (start < end && /\s/.test(text[start])) start++;
    let trimmedEnd = end;
    while (trimmedEnd > start && /\s/.test(text[trimmedEnd - 1])) trimmedEnd--;
    if (trimmedEnd > start) sentences.push({ id: `s:${start}:${trimmedEnd}`, start, end: trimmedEnd });
    start = end;
  };
  for (const match of text.matchAll(/\n|[.!?…]["'”’)\]]*(?=\s|$)|[。！？]["'”’)\]]*/g)) {
    const end = match.index! + match[0].length;
    if (match[0][0] === '.' && abbreviation.test(text.slice(start, end))) continue;
    add(end);
  }
  add(text.length);
  return sentences;
}

/** Keep the proven 160-character/token fallback, but never combine two sentences. */
export function sourceSpeechChunks(text: string): SourceChunk[] {
  return sourceSentences(text).flatMap(sentence => {
    let cursor = sentence.start;
    const pieces = splitSpeech(text.slice(sentence.start, sentence.end));
    return pieces.map((piece, index) => {
      const words = piece.trim();
      const start = text.indexOf(words, cursor);
      if (start < cursor || start + words.length > sentence.end) throw Error('Speech source mapping failed.');
      cursor = start + words.length;
      // splitSpeech marks every input end as a paragraph. Preserve that cue only
      // at an actual source block/document boundary, not at every new sentence.
      const blockEnd = cursor === text.length || text[cursor] === '\n';
      return { text: words + (index === pieces.length - 1 && blockEnd ? '\n' : ''), start, end: cursor };
    });
  });
}

export function splitSourceChunk(chunk: SourceChunk, parts: string[]): SourceChunk[] {
  if (parts.join('') !== chunk.text || parts.some(part => !part.length)) throw Error('Invalid speech split.');
  let cursor = chunk.start;
  return parts.map(text => {
    const start = Math.min(chunk.end, cursor + text.length - text.trimStart().length);
    const end = Math.min(chunk.end, cursor + text.trimEnd().length);
    cursor += text.length;
    return { text, start, end };
  });
}

/** PCM sample durations identify the segment; only the media clock selects it. */
export function spokenPositionAt(cues: SpeechCue[], sentences: SourceSentence[], seconds: number): SpokenPosition {
  if (!Number.isFinite(seconds)) return { precision: 'unavailable' };
  const cue = cues.find(cue => seconds >= cue.audioStart && seconds < cue.audioEnd);
  if (!cue || cue.end <= cue.start) return { precision: 'unavailable' };
  const sentence = sentences.find(sentence => cue.start >= sentence.start && cue.end <= sentence.end);
  return sentence ? { precision: 'sentence', start: sentence.start, end: sentence.end }
    : { precision: 'chunk', start: cue.start, end: cue.end };
}

export function highlightDescription(position?: SpokenPosition): string {
  return position?.precision === 'sentence' ? 'The current sentence is highlighted on the source page.'
    : position?.precision === 'chunk' ? 'The current passage is highlighted; sentence timing within it is unavailable.'
    : 'Sentence highlighting is unavailable for this voice or source.';
}
