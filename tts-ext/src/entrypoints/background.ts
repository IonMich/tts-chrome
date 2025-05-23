export default defineBackground(() => {
  // Create context menu item on install
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'readText',
      title: 'Read Text',
      contexts: ['selection'],
    });
    console.log("[Background] Context menu created/updated.");
  });

  // Handle context menu click
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'readText' && info.selectionText) {
      console.log(`[Background] Context menu 'readText' clicked.`);
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        const target = tabs[0];
        if (target && target.id != null) {
          chrome.storage.sync.get(['voice', 'speed']).then(({ voice, speed }) => {
            const v = voice || 'af_sarah';
            const sp = speed ?? 1.0;
            chrome.tabs.sendMessage(target.id!, { action: 'readText', text: info.selectionText!, voice: v, speed: sp });
          });
        }
      }).catch(err => console.error("[Background] Error processing context menu click:", err));
    }
  });

  // Handle keyboard command
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'trigger_tts') {
      console.log("[Background] 'trigger_tts' command received.");
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        const target = tabs[0];
        if (target && target.id != null) {
          chrome.scripting.executeScript({
            target: { tabId: target.id },
            func: () => window.getSelection()?.toString() || '',
          }).then((results) => {
            if (chrome.runtime.lastError) {
              console.error("[Background] Error executing script to get selection:", chrome.runtime.lastError.message);
              return;
            }
            const selected = results && results[0]?.result as string;
            if (selected && selected.trim()) {
              chrome.storage.sync.get(['voice', 'speed']).then(({ voice, speed }) => {
                const v = voice || 'af_sarah';
                const sp = speed ?? 1.0;
                chrome.tabs.sendMessage(target.id!, { action: 'readText', text: selected, voice: v, speed: sp });
              });
            }
          }).catch(err => console.error("[Background] Error processing command:", err));
        }
      }).catch(err => console.error("[Background] Error querying tabs for command:", err));
    }
  });
});
