export interface ScrubSnapshot {
  phase: string; elapsedSec: number; seekableStartSec?: number; seekableEndSec?: number;
  sessionId?: string; revision?: number;
}
export type ScrubCommandResult = ScrubSnapshot | void;
export interface ScrubCommands {
  pause: () => ScrubCommandResult | Promise<ScrubCommandResult>;
  resume: () => ScrubCommandResult | Promise<ScrubCommandResult>;
  seek: (seconds: number) => ScrubCommandResult | Promise<ScrubCommandResult>;
}
export interface ScrubView { seconds: number; start: number; end: number; dragging: boolean; }
const playing = (s: ScrubSnapshot) => s.phase === 'playing' || s.phase === 'buffering';
const range = (s: ScrubSnapshot) => ({ start: Math.max(0, s.seekableStartSec ?? 0), end: Math.max(0, s.seekableEndSec ?? 0) });
const clamp = (n: number, r: { start: number; end: number }) => Math.max(r.start, Math.min(r.end, n));

/** One gesture owns its local preview until the engine acknowledges its final position.
 * Incoming playback ticks never replace an active drag. Commands are awaited in order;
 * newer intentions skip old queued work and prevent an old seek from resuming playback.
 */
export class ReaderScrubber {
  private latest: ScrubSnapshot;
  private view: ScrubView | null = null;
  private pointer: number | null = null;
  private generation = 0;
  private queue = Promise.resolve();
  private wantPlay: boolean | undefined;
  private pausedForScrub = false;
  private acknowledged: ScrubSnapshot | undefined;
  private disposed = false;
  constructor(initial: ScrubSnapshot, public commands: ScrubCommands, private changed: (view: ScrubView | null) => void) { this.latest = initial; }
  get preview() { return this.view; }
  get pointerId() { return this.pointer; }
  activate() { this.disposed = false; }
  private paint(view: ScrubView | null) { this.view = view; if (!this.disposed) this.changed(view); }
  private clear() { this.pointer = null; this.wantPlay = undefined; this.pausedForScrub = false; this.acknowledged = undefined; this.paint(null); }
  dispose() { this.disposed = true; this.generation++; this.pointer = null; this.view = null; this.wantPlay = undefined; this.acknowledged = undefined; }
  observe(next: ScrubSnapshot) {
    const previous = this.latest;
    this.latest = next;
    if (next.sessionId !== previous.sessionId || ['idle', 'error'].includes(next.phase) || range(next).end <= range(next).start) {
      if (this.view) { this.generation++; this.clear(); }
      return;
    }
    this.releaseAcknowledgedPreview();
  }
  private releaseAcknowledgedPreview() {
    const ack = this.acknowledged;
    if (!this.view || this.view.dragging || !ack) return;
    const caughtUp = ack.revision !== undefined
      ? this.latest.sessionId === ack.sessionId && (this.latest.revision ?? -1) >= ack.revision
      : Math.abs(this.latest.elapsedSec - ack.elapsedSec) < .3;
    if (caughtUp) this.clear();
  }
  private enqueue(generation: number, work: () => Promise<void>) {
    this.queue = this.queue.then(async () => {
      if (this.disposed || generation !== this.generation) return;
      await work();
    }).catch(() => { if (!this.disposed && generation === this.generation) this.clear(); });
  }
  private finish(generation: number, result: ScrubCommandResult, fallback: number) {
    if (this.disposed || generation !== this.generation || !this.view) return;
    this.acknowledged = result || { ...this.latest, elapsedSec: fallback, revision: undefined };
    this.paint({ ...this.view, dragging: false, seconds: clamp(this.acknowledged.elapsedSec, this.view) });
    this.releaseAcknowledgedPreview();
  }
  begin(pointerId: number) {
    const bounds = range(this.latest);
    if (this.disposed || bounds.end <= bounds.start || this.pointer !== null) return;
    const generation = ++this.generation, commands = this.commands;
    this.wantPlay ??= playing(this.latest);
    this.acknowledged = undefined;
    this.pointer = pointerId;
    this.paint({ ...bounds, seconds: clamp(this.view?.seconds ?? this.latest.elapsedSec, bounds), dragging: true });
    if (this.wantPlay) {
      this.pausedForScrub = true;
      this.enqueue(generation, async () => { await commands.pause(); });
    }
  }
  move(seconds: number) {
    if (this.pointer === null || !this.view) return;
    this.paint({ ...this.view, seconds: clamp(seconds, this.view) });
  }
  end(pointerId: number, seconds: number) {
    if (this.pointer !== pointerId || !this.view) return;
    this.pointer = null;
    this.commit(seconds);
  }
  seek(seconds: number, resumeAfter = false) {
    if (this.pointer !== null) { this.move(seconds); return; }
    // Native range input may report the release value again as a change event.
    if (this.view && Math.abs(this.view.seconds - seconds) < .01) return;
    ++this.generation;
    if (resumeAfter) { this.wantPlay = true; this.pausedForScrub = true; }
    this.wantPlay ??= playing(this.latest);
    this.commit(seconds);
  }
  private commit(seconds: number) {
    const generation = this.generation, commands = this.commands;
    const bounds = this.view ?? range(this.latest);
    this.acknowledged = undefined;
    this.paint({ start: bounds.start, end: bounds.end, seconds: clamp(seconds, bounds), dragging: false });
    this.enqueue(generation, async () => {
      // History may have expired or moved since pointerdown; clamp at commit too.
      const actual = range(this.latest);
      if (actual.end <= actual.start) { this.clear(); return; }
      const target = clamp(seconds, actual);
      let result = await commands.seek(target);
      if (this.disposed || generation !== this.generation) return;
      if (this.wantPlay && this.pausedForScrub) result = await commands.resume();
      this.finish(generation, result, target);
    });
  }
  cancel(pointerId: number) {
    if (this.pointer !== pointerId || !this.view) return;
    const generation = ++this.generation, commands = this.commands;
    this.pointer = null;
    this.acknowledged = undefined;
    this.paint({ ...range(this.latest), seconds: this.latest.elapsedSec, dragging: false });
    this.enqueue(generation, async () => {
      const result = this.wantPlay && this.pausedForScrub ? await commands.resume() : undefined;
      this.finish(generation, result, this.latest.elapsedSec);
    });
  }
}
