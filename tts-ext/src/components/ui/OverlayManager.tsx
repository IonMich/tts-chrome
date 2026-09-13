import { useEffect, useRef, useState } from 'react';
import Overlay from './Overlay';
import { pauseReader, resumeReader, seekReader, setReaderSpeed, stopReader, subscribeReader } from '@/lib/readerClient';
import { idleSnapshot, isCurrentSnapshot, type ReaderSnapshot } from '@/lib/readerProtocol';

/** Mounted only by an explicit reader:show command; state broadcasts never mount it. */
export default function OverlayManager({ onDismiss }: { onDismiss: () => void }) {
  const [snapshot, setSnapshot] = useState<ReaderSnapshot>({ ...idleSnapshot(), phase: 'preparing' });
  const dismissed = useRef(false);
  const dismiss = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    onDismiss();
  };
  useEffect(() => subscribeReader(next => {
    if (dismissed.current) return;
    if (next.phase === 'idle') { dismiss(); return; }
    setSnapshot(current => isCurrentSnapshot(current, next) ? next : current);
  }), []);
  const run = async (command: () => Promise<void | ReaderSnapshot>) => {
    const sessionId = snapshot.sessionId;
    try {
      const next = await command();
      if (next && !dismissed.current) setSnapshot(current => current.sessionId === sessionId && isCurrentSnapshot(current, next) ? next : current);
      return next;
    } catch (error) {
      if (!dismissed.current) setSnapshot(current => current.sessionId === sessionId ? ({ ...current, phase: 'error', error: error instanceof Error ? error.message : String(error) }) : current);
      throw error;
    }
  };
  return <Overlay snapshot={snapshot} onPause={() => run(()=>pauseReader(snapshot.sessionId))} onResume={() => run(()=>resumeReader(snapshot.sessionId))} onSeek={s=>run(()=>seekReader(s,snapshot.sessionId))} onSpeed={s=>void run(()=>setReaderSpeed(s)).catch(()=>{})} onClose={() => {
    // Hide synchronously; late state messages cannot revive a dismissed player.
    dismiss();
    void stopReader().catch(() => {});
  }} />;
}
