chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "readText",
    title: "Read Text",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "readText" && info.selectionText) {
    // Get stored voice and send it along with selection
    chrome.storage.sync.get(["voice"], ({ voice }) => {
      const v = voice || 'af_sarah';
      chrome.tabs.sendMessage(tab.id, { action: "readText", text: info.selectionText, voice: v }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error sending message to content script:", chrome.runtime.lastError.message);
        } else {
          console.log("Message sent successfully:", response);
        }
      });
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
