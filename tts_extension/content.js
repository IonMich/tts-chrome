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
    if (container) {
      container.remove();
      // also clear progress when controls go away
      clearInterval(progressInterval);
      removeProgressBar();
    }
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
      // only remove controls once all websocket streams closed and scheduled playback has finished
      if (tts.activeSockets.length === 0 && tts.nextTime !== null && tts.audioContext.currentTime >= tts.nextTime) {
        clearInterval(interval);
        hideLoadingSpinner();
        removeTTSControls();
      }
    }, 500);
  }

  // Progress bar utilities
  let progressInterval;
  let barStartTime; // time when playback actually begins
  let segment1Duration = 0; // actual duration of first segment

  function createProgressBar() {
    if (document.getElementById('tts-progress-container')) return;
    const container = document.createElement('div');
    container.id = 'tts-progress-container';
    Object.assign(container.style, {
      position: 'fixed', bottom: '10px', left: '10px',
      width: '200px', height: '10px', backgroundColor: '#ccc', zIndex: '2147483647'
    });
    const bar = document.createElement('div');
    bar.id = 'tts-progress-bar';
    Object.assign(bar.style, {
      width: '0%', height: '100%', backgroundColor: '#3b82f6'
    });
    container.appendChild(bar);
    document.body.appendChild(container);
  }
  function updateProgressBar(elapsed, total) {
    const percent = Math.min(100, (elapsed / total) * 100);
    const bar = document.getElementById('tts-progress-bar');
    if (bar) bar.style.width = percent + '%';
  }
  function removeProgressBar() {
    const container = document.getElementById('tts-progress-container');
    if (container) container.remove();
  }

  // Estimate duration based on character count
  function estimateDuration(text) {
    const charsPerSecond = 15; // rough initial guess
    return text.length / charsPerSecond;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "readText" && message.text) {
      // prepare dynamic total duration
      const { firstSegment, secondSegment } = utils.splitTextForHybrid(message.text, 15, 3);
      let totalDuration = estimateDuration(message.text);

      // apply selected voice to TTS module
      if (message.voice) {
        tts.setCurrentVoice(message.voice);
      }
      tts.secondSegmentStarted = false;
      tts.nextTime = null;

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
          await tts.processSegment(firstSegment, () => {
            // start progress bar on first chunk
            createProgressBar();
            barStartTime = tts.audioContext.currentTime;
            // start continuous progress update using dynamic totalDuration
            progressInterval = setInterval(() => {
              const elapsed = tts.audioContext.currentTime - barStartTime;
              updateProgressBar(elapsed, totalDuration);
            }, 100);
          });
          // refine totalDuration after scheduling first segment
          const actual1 = tts.nextTime - barStartTime;
          const est2 = secondSegment ? estimateDuration(secondSegment) : 0;
          totalDuration = actual1 + est2;
          hideLoadingSpinner();
          if (secondSegment) {
            await tts.processSegment(secondSegment);
            // refine totalDuration with actual full schedule
            totalDuration = tts.nextTime - barStartTime;
          }
          // continue updating until playback end
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
