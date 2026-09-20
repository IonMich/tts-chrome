// Preserve block boundaries so headings, dates and paragraphs remain distinct.
export function normalizeSpeechText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
}
const abbreviation = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z]|\b(?:[A-Za-z]\.)+[A-Za-z])\.$/i;
const CHUNK_TARGET = 160;
const BOUNDARY_LOOKAHEAD = 64;
export const MAX_SPEECH_CHUNK_LENGTH = CHUNK_TARGET + BOUNDARY_LOOKAHEAD;
function boundaries(text: string, punctuation: RegExp): number[] {
  const ends: number[] = [];
  for (const match of text.matchAll(punctuation)) {
    const end = match.index! + match[0].length;
    // Only the token before this period matters; scanning the whole article per
    // punctuation mark would make source-sentence detection quadratic.
    if (match[0][0] === '.' && abbreviation.test(text.slice(Math.max(0, match.index! - 32), match.index! + 1))) continue;
    ends.push(end);
  }
  return ends;
}
/** Shared by inference chunking and source highlighting, including paragraph ends. */
export function speechSentenceEnds(text: string): number[] {
  return boundaries(text, /\n|[.!?…]["'”’)\]]*(?=\s|$)|[。！？]["'”’)\]]*/g);
}
/** Aim for 160 characters, but finish a nearby sentence/clause before falling back to words. */
export function splitSpeech(text: string, firstLimit = CHUNK_TARGET, laterLimit = CHUNK_TARGET): string[] {
  const chunks: string[] = [];
  for (const block of normalizeSpeechText(text).split('\n')) {
    let offset = 0;
    while (offset < block.length) {
      const requestedLimit = chunks.length ? laterLimit : firstLimit;
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(CHUNK_TARGET, Math.floor(requestedLimit))) : CHUNK_TARGET;
      const maxEnd = Math.min(MAX_SPEECH_CHUNK_LENGTH, limit + BOUNDARY_LOOKAHEAD);
      if (block.length - offset <= limit) { chunks.push(block.slice(offset) + '\n'); break; }
      // The extra character ensures a truncated window cannot invent punctuation boundaries.
      const window = block.slice(offset, offset + maxEnd + 1);
      const sentences = speechSentenceEnds(window).filter(end => end <= maxEnd && end >= 35);
      const clauses = boundaries(window, /[;:,]["'”’)\]]*(?=\s|$)/g).filter(end => end <= maxEnd && end >= 35);
      const nearest = (ends: number[]) => ends.filter(end => end <= limit).at(-1) ?? ends[0];
      const paragraphEnd = block.length - offset <= maxEnd ? block.length - offset : undefined;
      // Prefer complete sentences, including a small lookahead, over any internal clause.
      let cut = nearest(sentences) ?? paragraphEnd ?? nearest(clauses) ?? window.lastIndexOf(' ', limit);
      if (cut < 1) cut = limit;
      if (!sentences.length && !clauses.length && paragraphEnd === undefined) {
        const prefix = block.slice(offset, offset + cut);
        const dangling = prefix.match(/\s+(?:the|a|an|of|to|into|in|on|at|for|with|from|and|or|but)$/i);
        if (dangling && dangling.index! > limit / 2) cut = dangling.index!;
      }
      chunks.push(block.slice(offset, offset + cut).trim() + (offset + cut === block.length ? '\n' : ''));
      offset += cut;
      while (block[offset] === ' ') offset++;
    }
  }
  return chunks.filter(Boolean);
}
