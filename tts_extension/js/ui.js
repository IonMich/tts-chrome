export function updateClearButton() {
  const inputText = document.getElementById("inputText").value.trim();
  const clearBtn = document.getElementById("clearBtn");
  clearBtn.disabled = inputText.length === 0;
}

export function updateStopButton(activeSources, activeSockets) {
  const stopBtn = document.getElementById("stopBtn");
  stopBtn.disabled = activeSources.length === 0 && activeSockets.length === 0;
}

export function updateSpeakButton(processing) {
  const speakBtn = document.getElementById("speakBtn");
  speakBtn.disabled = processing;
}
