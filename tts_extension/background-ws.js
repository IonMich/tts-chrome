chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "readText",
    title: "Read Text",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "readText" && info.selectionText) {
    // Send TTS message to the active tab (ignore passed-in tab in Chrome PDF viewer)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const targetTab = tabs[0];
      if (targetTab && typeof targetTab.id === 'number') {
        chrome.storage.sync.get(["voice"], ({ voice }) => {
          const v = voice || 'af_sarah';
          chrome.tabs.sendMessage(targetTab.id, { action: "readText", text: info.selectionText, voice: v }, (response) => {
            if (chrome.runtime.lastError) {
              console.error("Error sending message to content script:", chrome.runtime.lastError.message);
            } else {
              console.log("Message sent successfully:", response);
            }
          });
        });
      } else {
        console.error("No active tab to send TTS message to");
      }
    });
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "trigger_tts") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          function: () => window.getSelection().toString()
        }, (results) => {
          if (results && results[0] && results[0].result) {
            const selectedText = results[0].result;
            if (selectedText.trim() !== "") {
              // Get stored voice and send with command
              chrome.storage.sync.get(["voice"], ({ voice }) => {
                const v = voice || 'af_sarah';
                chrome.tabs.sendMessage(tabs[0].id, { action: "readText", text: selectedText, voice: v }, (response) => {
                  if (chrome.runtime.lastError) {
                    console.error("Error sending message to content script:", chrome.runtime.lastError.message);
                  } else {
                    console.log("Keyboard command message sent successfully:", response);
                  }
                });
              });
            } else {
              console.warn("No text selected");
            }
          }
        });
      }
    });
  }
});
