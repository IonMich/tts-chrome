import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import OverlayManager from '@/components/ui/OverlayManager';
import '@/components/reader/reader.css';
import { READER_CHANNEL } from '@/lib/readerProtocol';

type PlayerUi = { mount: () => void; remove: () => void; shadowHost: HTMLElement };
type ReaderWindow = Window & { __localReaderController?: { dispose: () => void } };

export default defineContentScript({
  registration: 'runtime',
  matches: [],
  cssInjectionMode: 'ui',
  runAt: 'document_end',
  main(ctx) {
    const scope = window as ReaderWindow;
    // executeScript may be called repeatedly on the same page.
    // WXT invalidates the old context asynchronously on reinjection. Replace it
    // synchronously so the new explicit show always has a live listener.
    scope.__localReaderController?.dispose();
    let ui: PlayerUi | undefined;
    let generation = 0;
    let opening: Promise<void> | undefined;
    let previousFocus: Element | null = null;
    const dismiss = () => {
      generation++;
      opening = undefined;
      const ownedFocus = ui?.shadowHost === document.activeElement;
      ui?.remove();
      ui = undefined;
      if (ownedFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    };
    const focus = () => ui?.shadowHost.shadowRoot?.querySelector<HTMLElement>('[data-reader-focus]')?.focus({ preventScroll: true });
    const show = async (moveFocus: boolean) => {
      if (ui) { if (moveFocus) focus(); return; }
      if (opening) { await opening; if (moveFocus) focus(); return; }
      const request = ++generation;
      previousFocus = document.activeElement;
      opening = (async () => {
        const next = await createShadowRootUi<Root>(ctx, {
        name: 'tts-overlay',
        position: 'inline',
        anchor: 'body',
        onMount(container) {
          const host = document.createElement('div');
          container.append(host);
          const root = createRoot(host);
          flushSync(() => root.render(<OverlayManager onDismiss={dismiss} />));
          return root;
        },
        onRemove(root) { root?.unmount(); },
      });
        if (request !== generation) { next.remove(); throw new Error('Player opening was cancelled.'); }
        ui = next;
        next.mount();
      })();
      try { await opening; if (moveFocus) focus(); }
      finally { if (request === generation) opening = undefined; }
    };
    const listener = (message: { type?: string; focus?: boolean; channel?: string; action?: string; snapshot?: { phase?: string } }, sender: chrome.runtime.MessageSender, respond: (response: { shown: boolean }) => void) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message?.channel === READER_CHANNEL && message.action === 'state' && message.snapshot?.phase === 'idle') dismiss();
      if (message?.type === 'reader:show') {
        void show(message.focus !== false).then(() => respond({ shown: !!ui }), () => respond({ shown: false }));
        return true;
      }
    };
    // Register before creating the shadow UI so an immediate show command is not lost.
    chrome.runtime.onMessage.addListener(listener);
    const controller = { dispose() {
      chrome.runtime.onMessage.removeListener(listener);
      dismiss();
      if (scope.__localReaderController === controller) delete scope.__localReaderController;
    } };
    scope.__localReaderController = controller;
    ctx.onInvalidated(controller.dispose);
  },
});
