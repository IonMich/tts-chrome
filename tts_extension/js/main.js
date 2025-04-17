import { splitTextForHybrid } from "./utils.js";
import { processSegment, stopSpeech, activeSources, activeSockets, reset, setCurrentVoice } from "./tts.js";
import { updateClearButton, updateStopButton, updateSpeakButton } from "./ui.js";

function waitForPlaybackCompletion() {
  return new Promise(resolve => {
    const check = () => {
      if (activeSources.length === 0) {
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

let processing = false;

document.addEventListener("DOMContentLoaded", () => {
  const voiceSelect = document.getElementById("voiceSelect");
  // Load persisted voice or default
  chrome.storage.sync.get(["voice"], ({ voice }) => {
    const v = voice || 'af_sarah';
    setCurrentVoice(v);
    if (voiceSelect) voiceSelect.value = v;
  });
  // Handle voice selection changes
  voiceSelect.addEventListener('change', (e) => {
    const v = e.target.value;
    setCurrentVoice(v);
    chrome.storage.sync.set({ voice: v });
  });

  const speakBtn = document.getElementById("speakBtn");
  const clearBtn = document.getElementById("clearBtn");
  const stopBtn = document.getElementById("stopBtn");
  const inputTextArea = document.getElementById("inputText");

  if (!speakBtn || !clearBtn || !stopBtn) {
    console.error("One or more UI elements not found");
    return;
  }

  inputTextArea.addEventListener("input", updateClearButton);
  updateClearButton();
  updateSpeakButton(processing);
  updateStopButton(activeSources, activeSockets);

  speakBtn.addEventListener("click", async () => {
    const fullText = inputTextArea.value;
    if (!fullText.trim()) {
      console.warn("No text provided");
      return;
    }
    processing = true;
    updateSpeakButton(processing);
    stopBtn.disabled = false;

    const { firstSegment, secondSegment } = splitTextForHybrid(fullText, 15, 3);
    console.log("First segment:", firstSegment);
    console.log("Second segment:", secondSegment);

    reset();
    try {
      await processSegment(firstSegment);
      if (secondSegment) {
        console.log("Starting second segment.");
        await processSegment(secondSegment);
      }
    } catch (e) {
      console.error("Error processing segments:", e);
    }
    console.log("All segments processed.");

    await waitForPlaybackCompletion();
    processing = false;
    updateSpeakButton(processing);
    updateStopButton(activeSources, activeSockets);
    console.log("Playback complete.");
  });

  clearBtn.addEventListener("click", () => {
    inputTextArea.value = "";
    updateClearButton();
    console.log("Text cleared.");
  });

  stopBtn.addEventListener("click", () => {
    stopSpeech();
    processing = false;
    updateSpeakButton(processing);
    updateStopButton(activeSources, activeSockets);
    console.log("Speech stopped.");
  });
});
