import { ReaderPlayer, type ReaderPlayerProps } from '@/components/reader/ReaderPlayer';
import type { ReaderSnapshot } from '@/lib/readerProtocol';

interface OverlayProps {
  snapshot: ReaderSnapshot;
  onPause: ReaderPlayerProps['onPause'];
  onResume: ReaderPlayerProps['onResume'];
  onClose: () => void;
  onSeek:NonNullable<ReaderPlayerProps['onSeek']>; onSpeed:(speed:number)=>void;
  onVoice: NonNullable<ReaderPlayerProps['onVoice']>;
}

/** Presentation only. Speech and model lifetime belong to the background session. */
export default function Overlay({ snapshot, onPause, onResume, onClose, onSeek, onSpeed, onVoice }: OverlayProps) {
  return <div data-reader-focus tabIndex={-1} style={{ outline: 'none' }} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}><ReaderPlayer state={snapshot} floating onPause={onPause} onResume={onResume} onClose={onClose} onSeek={onSeek} onSpeed={onSpeed} onVoice={onVoice} /></div>;
}
