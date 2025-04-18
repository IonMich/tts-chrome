import React from 'react';
import { createRoot } from 'react-dom/client';
import Overlay from '@/components/ui/Overlay';
import '@/index.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'tts-overlay',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        const host = document.createElement('div');
        container.append(host);
        const root = createRoot(host);
        chrome.runtime.onMessage.addListener((message) => {
          if (message.action === 'readText' && message.text) {
            host.style.display = '';
            root.render(
              <Overlay
                text={message.text}
                voice={message.voice}
                onClose={() => { host.style.display = 'none'; }}
              />
            );
          }
        });
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
