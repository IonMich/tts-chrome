import React from 'react';
import { createRoot } from 'react-dom/client';
import OverlayManager from '@/components/ui/OverlayManager';
import '@/index.css';

export default defineContentScript({
  matches: ['<all_urls>', '*://*/*pdf*'],
  cssInjectionMode: 'ui',
  runAt: 'document_end',
  async main(ctx) {
    // Model loading is now handled lazily by modelLoader when TTS is first requested
    console.log("[Content Script] Content script initialized - model will load when needed");

    const ui = await createShadowRootUi(ctx, {
      name: 'tts-overlay',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        const host = document.createElement('div');
        container.append(host);
        const root = createRoot(host);
        // render the queue-aware manager
        root.render(<OverlayManager host={host} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
