(async () => {
  const utils = await import(chrome.runtime.getURL('js/utils.js'));
  const tts = await import(chrome.runtime.getURL('js/tts.js'));

  function showLoadingSpinner() {
    if (!document.getElementById("tts-spinner")) {
      const spinner = document.createElement("div");
      spinner.id = "tts-spinner";
      spinner.innerHTML = `
        <svg style="width:40px;height:40px;display:block;" viewBox="0 0 50 50">
          <circle style="stroke:#3b82f6; stroke-width:4; fill:none; opacity:0.25;" cx="25" cy="25" r="20"></circle>
          <path style="fill:#3b82f6; opacity:0.75;" d="M25 5a20 20 0 0 1 0 40V5z">
            <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/>
          </path>
        </svg>
      `;
      spinner.style.position = "fixed";
      spinner.style.top = "10px";
      spinner.style.right = "10px";
      spinner.style.zIndex = "2147483647";
      document.body.appendChild(spinner);
    }
  }

  function hideLoadingSpinner() {
    const spinner = document.getElementById("tts-spinner");
    if (spinner) spinner.remove();
  }

  function createTTSControls() {
    if (document.getElementById("tts-controls")) return document.getElementById("tts-controls");

    const container = document.createElement("div");
    container.id = "tts-controls";
    container.style.position = "fixed";
    container.style.right = "2rem";
    container.style.top = "50%";
    container.style.transform = "translateY(-50%)";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "2rem";
    container.style.zIndex = "2147483647";

    const pauseBtn = document.createElement("button");
    pauseBtn.id = "pauseBtn";
    pauseBtn.className = "btn btn-circle btn-primary";
    pauseBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="24" height="24" viewBox="0 0 16 16">
        <path d="M5 3.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8A.5.5 0 0 1 5 3.5zm5 0a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8a.5.5 0 0 1 .5-.5z"/>
      </svg>
    `;
    container.appendChild(pauseBtn);

    const stopBtnOverlay = document.createElement("button");
    stopBtnOverlay.id = "stopBtnOverlay";
    stopBtnOverlay.className = "btn btn-circle btn-error";
    stopBtnOverlay.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="24" height="24" viewBox="0 0 16 16">
        <path d="M6 6h4v4H6V6z"/>
        <path fill-rule="evenodd" d="M1 2a1 1 0 0 1 1-1h12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2zm1 0v12h12V2H2z"/>
      </svg>
    `;
    container.appendChild(stopBtnOverlay);

    document.body.appendChild(container);
    return container;
  }

  function removeTTSControls() {
    const container = document.getElementById("tts-controls");
    if (container) container.remove();
  }

  let paused = false;
  async function togglePause(pauseBtn) {
    if (!paused) {
      await tts.audioContext.suspend();
      paused = true;
      pauseBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="24" height="24" viewBox="0 0 16 16">
          <path d="M10.804 8L5 4.633v6.734L10.804 8z"/>
        </svg>
      `;
    } else {
      await tts.audioContext.resume();
      paused = false;
      pauseBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="24" height="24" viewBox="0 0 16 16">
          <path d="M5 3.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8A.5.5 0 0 1 5 3.5zm5 0a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8a.5.5 0 0 1 .5-.5z"/>
        </svg>
      `;
    }
  }

  function monitorPlaybackAndRemoveControls() {
    const interval = setInterval(() => {
      if (tts.activeSources.length === 0 && tts.activeSockets.length === 0) {
        clearInterval(interval);
        hideLoadingSpinner();
        removeTTSControls();
      }
    }, 1000);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "readText" && message.text) {
      // apply selected voice to TTS module
      if (message.voice) {
        tts.setCurrentVoice(message.voice);
      }
      tts.secondSegmentStarted = false;
      tts.nextTime = null;
      const { firstSegment, secondSegment } = utils.splitTextForHybrid(message.text, 15, 3);

      showLoadingSpinner();
      const controls = createTTSControls();
      const pauseBtn = document.getElementById("pauseBtn");
      const stopBtnOverlay = document.getElementById("stopBtnOverlay");

      pauseBtn.addEventListener("click", () => {
        togglePause(pauseBtn);
      });
      stopBtnOverlay.addEventListener("click", () => {
        tts.stopSpeech();
        removeTTSControls();
      });

      (async () => {
        tts.reset();
        try {
          await tts.processSegment(firstSegment);
          hideLoadingSpinner();
          if (secondSegment) {
            await tts.processSegment(secondSegment);
          }
          monitorPlaybackAndRemoveControls();
        } catch (e) {
          removeTTSControls();
          hideLoadingSpinner();
          tts.stopSpeech();
        }
      })();

      sendResponse({ success: true });
      return true;
    }
  });
})();
