export const audioContext = new (window.AudioContext || window.webkitAudioContext)();
export const gainNode = audioContext.createGain();
gainNode.gain.value = 2.0;
gainNode.connect(audioContext.destination);

export let nextTime = null;
export let secondSegmentStarted = false;
export let activeSources = [];
export let activeSockets = [];
export let currentVoice = 'af_sarah';

export function setCurrentVoice(voice) {
  currentVoice = voice;
}

export function processSegment(segmentText, onFirstChunkCallback) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:5050");
    ws.binaryType = "arraybuffer";
    activeSockets.push(ws);

    let segmentStartTime = 0;
    let firstChunkReceived = false;

    ws.onopen = () => {
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }
      if (nextTime === null) {
        nextTime = audioContext.currentTime;
      }
      segmentStartTime = performance.now();
      firstChunkReceived = false;
      // send text and selected voice
      ws.send(JSON.stringify({ text: segmentText, voice: currentVoice }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.error) {
          ws.close();
          reject(new Error(msg.error));
          return;
        }
        if (msg.end) {
          ws.close();
          return;
        }
      } catch (e) {}

      if (!firstChunkReceived) {
        firstChunkReceived = true;
        const firstChunkTime = performance.now();
        console.log(
          "Time-to-first-speech (streaming) for segment:",
          ((firstChunkTime - segmentStartTime) / 1000).toFixed(3),
          "seconds"
        );
        if (onFirstChunkCallback && !secondSegmentStarted) {
          secondSegmentStarted = true;
          onFirstChunkCallback();
        }
      }

      const arrayBuffer = event.data;
      const int16Array = new Int16Array(arrayBuffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32767;
      }
      const sampleRate = 24000;
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
      audioBuffer.copyToChannel(float32Array, 0);

      if (nextTime < audioContext.currentTime) {
        nextTime = audioContext.currentTime;
      }
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      source.start(nextTime);
      activeSources.push(source);
      source.onended = () => {
        activeSources = activeSources.filter(s => s !== source);
      };
      nextTime += audioBuffer.duration;
    };

    ws.onerror = (err) => {
      reject(err);
    };

    ws.onclose = () => {
      activeSockets = activeSockets.filter(s => s !== ws);
      resolve();
    };
  });
}

export function stopSpeech() {
  activeSources.forEach(source => {
    try {
      source.stop();
    } catch (e) {}
  });
  activeSources = [];
  activeSockets.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  });
  activeSockets = [];
  nextTime = null;
  secondSegmentStarted = false;
}

export function reset() {
  nextTime = null;
  secondSegmentStarted = false;
}
