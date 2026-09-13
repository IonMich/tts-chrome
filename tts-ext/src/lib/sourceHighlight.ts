import type { ReaderSnapshot } from './readerProtocol';
import { sourceRanges, type ReadingSource } from './sourceText';

/** CSS highlights paint text without wrappers, focus changes, selection changes or scrolling. */
export class SourceHighlight {
  private source?: ReadingSource;
  private sessionId?: string;
  private revision = -1;
  private painted = '';
  private style?: HTMLStyleElement;
  private observer?: MutationObserver;
  private readonly name = `local-reader-${crypto.randomUUID()}`;
  private readonly navigate = () => this.clear();
  constructor(private doc: Document) {
    doc.defaultView?.addEventListener('pagehide', this.navigate);
    doc.defaultView?.addEventListener('popstate', this.navigate);
    doc.defaultView?.addEventListener('hashchange', this.navigate);
  }
  get supported() { return typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined'; }
  prepare(source: ReadingSource, sessionId: string) {
    this.clear(); this.source = source; this.sessionId = sessionId;
    this.observer = new MutationObserver(records => {
      if (source.url !== this.doc.location.href) { this.clear(); return; }
      // Any modified source text invalidates its immutable mapping. Never relocate
      // duplicate text by searching the changed page. UI-only mutations are ignored.
      if (records.some(record => record.type === 'characterData' && source.runs.some(run => run.node === record.target)
        || record.type === 'childList' && Array.from(record.removedNodes).some(node => source.runs.some(run => node === run.node || node.contains(run.node))))) this.clear();
    });
    this.observer.observe(this.doc.body, { childList: true, subtree: true, characterData: true });
  }
  observe(snapshot: ReaderSnapshot) {
    if (!this.source || snapshot.sessionId !== this.sessionId) return;
    if (snapshot.sourceId && snapshot.sourceId !== this.source.sourceId) return;
    if (snapshot.revision !== undefined && snapshot.revision < this.revision) return;
    this.revision = snapshot.revision ?? this.revision;
    if (snapshot.phase === 'idle' || snapshot.phase === 'error' || (snapshot.phase === 'complete' && snapshot.speechMode !== 'system' && !snapshot.replayExpiresAt)) { this.clear(); return; }
    const position = snapshot.spokenPosition;
    if (this.source.url !== this.doc.location.href) { this.clear(); return; }
    if (!this.supported || snapshot.sourceId !== this.source.sourceId || !['playing', 'paused'].includes(snapshot.phase) || !position || position.precision === 'unavailable') { this.unpaint(); return; }
    const key = `${position.precision}:${position.start}:${position.end}`;
    if (key === this.painted) return;
    const ranges = sourceRanges(this.source, position.start, position.end, this.doc);
    if (!ranges.length) { this.unpaint(); return; }
    if (!this.style) {
      this.style = this.doc.createElement('style');
      this.style.textContent = `::highlight(${this.name}) { background-color: #ffe08a; color: #202124; text-decoration: underline; text-decoration-color: #725000; }
@media (forced-colors: active) { ::highlight(${this.name}) { background-color: Highlight; color: HighlightText; text-decoration-color: HighlightText; } }`;
      (this.doc.head ?? this.doc.documentElement).append(this.style);
    }
    const highlight = new Highlight(...ranges); highlight.priority = 1;
    CSS.highlights.set(this.name, highlight); this.painted = key;
  }
  private unpaint() { if (this.supported) CSS.highlights.delete(this.name); this.painted = ''; this.style?.remove(); this.style = undefined; }
  clear() { this.observer?.disconnect(); this.observer = undefined; this.unpaint(); this.source = undefined; this.sessionId = undefined; this.revision = -1; }
  dispose() {
    this.clear();
    this.doc.defaultView?.removeEventListener('pagehide', this.navigate);
    this.doc.defaultView?.removeEventListener('popstate', this.navigate);
    this.doc.defaultView?.removeEventListener('hashchange', this.navigate);
  }
}
