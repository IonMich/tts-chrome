// Preserve block boundaries so headings, dates and paragraphs remain distinct.
export function normalizeSpeechText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
}
const abbreviation = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z]|\b(?:[A-Za-z]\.)+[A-Za-z])\.$/i;
function boundaries(text: string, punctuation: RegExp): number[] {
  const ends: number[] = [];
  for (const match of text.matchAll(punctuation)) {
    const end = match.index! + match[0].length;
    if (match[0][0] === '.' && abbreviation.test(text.slice(0, end))) continue;
    ends.push(end);
  }
  return ends;
}
/** Bounded complete sentences/clauses, with a word-boundary fallback for long prose. */
export function splitSpeech(text: string, firstLimit = 160, laterLimit = 160): string[] {
  const chunks: string[] = [];
  for (const block of normalizeSpeechText(text).split('\n')) {
    let offset = 0;
    while (offset < block.length) {
      const limit = chunks.length ? laterLimit : firstLimit;
      if (block.length - offset <= limit) { chunks.push(block.slice(offset) + '\n'); break; }
      const window = block.slice(offset, offset + limit + 1);
      const sentences = boundaries(window, /[.!?…]["'”’)\]]*(?=\s|$)/g).filter(end => end <= limit && end >= 35);
      const clauses = boundaries(window, /[;:,]["'”’)\]]*(?=\s|$)/g).filter(end => end <= limit && end >= 35);
      let cut = sentences.at(-1) ?? clauses.at(-1) ?? window.lastIndexOf(' ', limit);
      if (cut < 1) cut = limit;
      if (!sentences.length && !clauses.length) {
        const prefix = block.slice(offset, offset + cut);
        const dangling = prefix.match(/\s+(?:the|a|an|of|to|in|on|at|for|with|from|and|or|but)$/i);
        if (dangling && dangling.index! > limit / 2) cut = dangling.index!;
      }
      chunks.push(block.slice(offset, offset + cut).trim());
      offset += cut;
      while (block[offset] === ' ') offset++;
    }
  }
  return chunks.filter(Boolean);
}
