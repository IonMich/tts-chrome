import { sourceSentences, type SourceSentence } from './speechPosition';

export interface TextFragment { text: string; node?: Text; offset?: number; }
export interface SourceRun { start: number; end: number; node: Text; nodeStart: number; nodeEnd: number; original: string; }
export interface ReadingSource { sourceId: string; text: string; sentences: SourceSentence[]; runs: SourceRun[]; url: string; }
const skip = 'nav,aside,footer,script,style,noscript,button,input,textarea,select,[hidden],[aria-hidden="true"],tts-overlay';

/** Streaming whitespace normalization with text-node provenance, not text searching. */
export function normalizeSourceFragments(fragments: TextFragment[]): { text: string; runs: SourceRun[] } {
  const output: string[] = [], runs: SourceRun[] = [];
  let length = 0, pending = '';
  const append = (text: string, fragment?: TextFragment, from = 0, to = 0) => {
    output.push(text);
    if (fragment?.node) {
      const nodeStart = (fragment.offset ?? 0) + from, nodeEnd = (fragment.offset ?? 0) + to;
      const last = runs.at(-1);
      if (last && last.node === fragment.node && last.end === length && last.nodeEnd === nodeStart && last.end - last.start === last.nodeEnd - last.nodeStart && text.length === nodeEnd - nodeStart) {
        last.end += text.length; last.nodeEnd = nodeEnd;
      } else runs.push({ start: length, end: length + text.length, node: fragment.node, nodeStart, nodeEnd, original: fragment.node.data });
    }
    length += text.length;
  };
  // Whitespace is synthetic in normalized text; only actual text runs are painted.
  // This avoids a DOM Range crossing excluded controls or hidden inline content.
  for (const fragment of fragments) {
    for (const match of fragment.text.matchAll(/\s+|\S+/g)) {
      if (/^\s/.test(match[0])) {
        if (/[\r\n]/.test(match[0])) pending = '\n';
        else pending ||= ' ';
      } else {
        if (pending && length) append(pending);
        pending = '';
        append(match[0], fragment, match.index!, match.index! + match[0].length);
      }
    }
  }
  return { text: output.join(''), runs };
}

/** Extract once in the content script so live DOM references survive the request. */
export function captureReadingSource(doc: Document, selectionOnly: boolean, sourceId: string): ReadingSource {
  const view = doc.defaultView!;
  const selected = selectionOnly ? view.getSelection() : null;
  const selection = selected?.rangeCount ? selected.getRangeAt(0).cloneRange() : null;
  const fragments: TextFragment[] = [];
  const root = selectionOnly ? doc.body : doc.querySelector('article') ?? doc.querySelector('main, [role="main"]') ?? doc.body;
  const read = (node: Node) => {
    if (selectionOnly && (!selection || selection.collapsed || !selection.intersectsNode(node))) return;
    if (node.nodeType === 3) {
      const text = node as Text;
      const start = selection?.startContainer === text ? selection.startOffset : 0;
      const end = selection?.endContainer === text ? selection.endOffset : text.length;
      fragments.push({ text: text.data.slice(start, end), node: text, offset: start });
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.matches(skip) || (!selectionOnly && root === doc.body && element.tagName === 'HEADER')) return;
    const style = view.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return;
    if (element.tagName === 'BR') { fragments.push({ text: '\n' }); return; }
    const inline = style.display === 'inline' || style.display === 'contents' || style.display.startsWith('inline-');
    if (!inline) fragments.push({ text: '\n' });
    for (const child of element.childNodes) read(child);
    if (!inline) fragments.push({ text: '\n' });
  };
  read(root);
  const { text, runs } = normalizeSourceFragments(fragments);
  return { sourceId, text, runs, sentences: sourceSentences(text), url: doc.location.href };
}

/** Range endpoints are clipped to the selected/text nodes, preserving all elements. */
export function sourceRanges(source: ReadingSource, start: number, end: number, doc: Document): Range[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.text.length || source.url !== doc.location.href) return [];
  const runs = source.runs.filter(run => run.end > start && run.start < end);
  if (runs.some(run => !run.node.isConnected || run.node.ownerDocument !== doc || run.node.data !== run.original)) return [];
  const ranges: Range[] = [];
  for (const run of runs) {
    const from = run.nodeStart + Math.max(0, start - run.start);
    const to = run.nodeEnd - Math.max(0, run.end - end);
    const last = ranges.at(-1);
    // Include original inter-word whitespace on the same node, never a skipped node.
    if (last?.endContainer === run.node && /^\s*$/.test(run.node.data.slice(last.endOffset, from))) last.setEnd(run.node, to);
    else { const range = doc.createRange(); range.setStart(run.node, from); range.setEnd(run.node, to); ranges.push(range); }
  }
  return ranges;
}
