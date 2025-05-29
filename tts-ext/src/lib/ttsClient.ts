export const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
export const gainNode = audioContext.createGain()
// Log default WebAudio sample rate
console.log(`[TTS Client] WebAudio audioContext.sampleRate: ${audioContext.sampleRate}`)
gainNode.gain.value = 2.0
gainNode.connect(audioContext.destination)

export let nextTime: number | null = null
let secondSegmentStarted = false

export let activeSources: AudioBufferSourceNode[] = []
export let activeSockets: WebSocket[] = []
export let currentVoice = 'af_sarah'
export let currentSpeed = 1.0

// track keys that have completed preload
export const preloadedSegments: Record<string, boolean> = {}
// track keys currently being preloaded to prevent duplicate sockets
export const preloadingSegments: Set<string> = new Set()
export const preloadedBuffers: Record<string, AudioBuffer[]> = {}

export function setCurrentVoice(voice: string) {
  currentVoice = voice
}

export function setCurrentSpeed(speed: number) {
  currentSpeed = speed
}

export function reset() {
  nextTime = null
  secondSegmentStarted = false
}

export async function processSegment(
  segmentText: string,
  onFirstChunk?: () => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:5050")
    ws.binaryType = "arraybuffer"
    activeSockets.push(ws)

    console.log(`[TTS Client] processSegment started for text length ${segmentText.length}`)
    let segmentStartTime = 0
    let firstChunkReceived = false
    // dynamic sample rate from server
    let sampleRate = audioContext.sampleRate

    ws.onopen = () => {
      console.log('[TTS Client] WebSocket opened, using initial sampleRate', sampleRate)
      if (audioContext.state === "suspended") audioContext.resume()
      if (nextTime === null) nextTime = audioContext.currentTime
      segmentStartTime = performance.now()
      firstChunkReceived = false
      ws.send(JSON.stringify({ text: segmentText, voice: currentVoice, speed: currentSpeed }))
    }

    ws.onmessage = event => {
      // ignore JSON messages
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data)
          if (msg.error) {
            ws.close()
            reject(new Error(msg.error))
            return
          }
          if (msg.end) {
            ws.close()
            return
          }
          // capture sample_rate from server
          if (msg.sample_rate) {
            console.log(`[TTS Client] Received server sample_rate: ${msg.sample_rate}`)
            sampleRate = msg.sample_rate
            return
          }
        } catch {}
        return
      }

      if (!firstChunkReceived) {
        firstChunkReceived = true
        if (!secondSegmentStarted) secondSegmentStarted = true
        if (onFirstChunk) onFirstChunk()
      }

      const arrayBuffer = event.data as ArrayBuffer
      const int16Array = new Int16Array(arrayBuffer)
      const float32Array = new Float32Array(int16Array.length)
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32767
      }
      console.log(`[TTS Client] Creating AudioBuffer: sampleRate=${sampleRate}, frames=${float32Array.length}`)
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate)
      audioBuffer.copyToChannel(float32Array, 0)

      if (nextTime! < audioContext.currentTime) nextTime = audioContext.currentTime
      const source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(gainNode)
      source.start(nextTime!) // non-null asserted

      activeSources.push(source)
      source.onended = () => {
        activeSources = activeSources.filter(s => s !== source)
      }
      nextTime! += audioBuffer.duration
    }

    ws.onerror = err => {
      reject(err)
    }

    ws.onclose = () => {
      activeSockets = activeSockets.filter(s => s !== ws)
      resolve()
    }
  })
}

/**
 * Preload TTS for text without scheduling playback.
 */
export async function preloadText(
  text: string,
  voice: string,
  speed: number
): Promise<void> {
  const key = `${text}|${voice}|${speed}`
  // skip if already loaded or currently loading
  if (preloadedSegments[key] || preloadingSegments.has(key)) return
  preloadingSegments.add(key)
  preloadedBuffers[key] = []
  console.log(`[TTS Client] preloadText: start key=${key}`)
  let sampleRate = audioContext.sampleRate
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:5050")
    ws.binaryType = "arraybuffer"
    // apply voice and speed
    setCurrentVoice(voice)
    setCurrentSpeed(speed)
    ws.onopen = () => {
      console.log(`[TTS Client] preloadText: ws.open, sending text len=${text.length}`)
      ws.send(JSON.stringify({ text, voice, speed }))
    }
    ws.onmessage = event => {
      // handle JSON messages
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data)
          if (msg.error) {
            ws.close(); reject(new Error(msg.error)); return
          }
          if (msg.end) { ws.close(); return }
          
          if (msg.sample_rate) {
            console.log(`[TTS Client] preloadText: received server sample_rate=${msg.sample_rate}`)
            sampleRate = msg.sample_rate
          }
        } catch {}
        return
      }
      // decode but do not schedule
      const arrayBuffer = event.data as ArrayBuffer
      const int16Array = new Int16Array(arrayBuffer)
      const float32Array = new Float32Array(int16Array.length)
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32767
      }
      console.log(`[TTS Client] preloadText: decoding chunk frames=${float32Array.length} sampleRate=${sampleRate}`)
      // create AudioBuffer with server sampleRate and store it
      const buffer = audioContext.createBuffer(1, float32Array.length, sampleRate)
      buffer.copyToChannel(float32Array, 0)
      preloadedBuffers[key].push(buffer)
    }
    ws.onerror = err => reject(err)
    ws.onclose = () => {
      preloadingSegments.delete(key)
      preloadedSegments[key] = true
      console.log(`[TTS Client] preloadText: complete key=${key}, buffers=${preloadedBuffers[key].length}`)
      resolve()
    }
  })
}

// Kokoro-JS client-side TTS processing
let kokoroInstance: any = null;

export function setKokoroInstance(instance: any) {
  console.log("[TTS Client] Kokoro instance is being set.");
  kokoroInstance = instance; // Set the global instance
}

export async function processSegmentClientSide(
  segmentText: string,
  onFirstChunk?: (actualDuration?: number) => void
): Promise<void> {
  if (!kokoroInstance) {
    console.error("[TTS Client CS] processSegment: Kokoro instance not set.");
    throw new Error("Kokoro instance not set. TTS operations cannot proceed.");
  }
  const activeKokoroInstance = kokoroInstance;

  try {
    if (audioContext.state === "suspended") await audioContext.resume();
    if (nextTime === null) nextTime = audioContext.currentTime;

    console.log(`[TTS Client CS] processSegment started for text length ${segmentText.length}`);
    const audioOutput = await activeKokoroInstance.generate(segmentText, { voice: currentVoice, speed: currentSpeed });
    const audioBlob = audioOutput.toBlob();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    if (onFirstChunk) onFirstChunk(audioBuffer.duration);

    if (nextTime! < audioContext.currentTime) nextTime = audioContext.currentTime;
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);
    source.start(nextTime!);

    activeSources.push(source);
    source.onended = () => {
      activeSources = activeSources.filter(s => s !== source);
    };
    nextTime! += audioBuffer.duration;

    console.log(`[TTS Client CS] AudioBuffer created and scheduled: sampleRate=${audioBuffer.sampleRate}, duration=${audioBuffer.duration}`);
    await waitForPlaybackCompletion();
  } catch (error) {
    console.error("[TTS Client CS] Error in processSegmentClientSide (TTS generation):", error);
    throw error;
  }
}

export async function preloadTextClientSide(
  text: string,
  voice: string,
  speed: number
): Promise<void> {
  if (!kokoroInstance) {
    console.error(`[TTS Client CS] preloadText: Kokoro instance not set for key ${text}|${voice}|${speed}|clientside.`);
    throw new Error("Kokoro instance not set. TTS preload operations cannot proceed.");
  }
  const activeKokoroInstance = kokoroInstance;
  const key = `${text}|${voice}|${speed}|clientside`;

  try {
    if (preloadedSegments[key] || preloadingSegments.has(key)) {
      console.log(`[TTS Client CS] preloadText (key: ${key}): Already preloaded or preloading.`);
      return;
    }

    preloadingSegments.add(key);
    preloadedBuffers[key] = [];
    console.log(`[TTS Client CS] preloadText: start key=${key}`);

    const audioOutput = await activeKokoroInstance.generate(text, { voice, speed });
    const audioBlob = audioOutput.toBlob();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    preloadedBuffers[key].push(audioBuffer);
    preloadedSegments[key] = true;
    console.log(`[TTS Client CS] preloadText: complete key=${key}, buffers=${preloadedBuffers[key].length}`);
  } catch (error) {
    console.error(`[TTS Client CS] Error in preloadTextClientSide (key: ${key}, TTS generation):`, error);
    throw error;
  } finally {
    preloadingSegments.delete(key);
  }
}


/**
 * Play preloaded audio buffers for a given text|voice|speed key.
 */
export async function playPreloadedText(
  text: string,
  voice: string,
  speed: number
): Promise<void> {
  const key = `${text}|${voice}|${speed}`
  const buffers = preloadedBuffers[key]
  if (!buffers || buffers.length === 0) return
  console.log(`[TTS Client] playPreloadedText: playing key=${key}, buffers=${buffers.length}, speed=${speed}`)
  // prepare audio context
  if (audioContext.state === 'suspended') await audioContext.resume()
  reset()
  setCurrentVoice(voice)
  setCurrentSpeed(speed)
  // schedule all buffers sequentially at requested speed
  nextTime = audioContext.currentTime
  buffers.forEach(buffer => {
    console.log(`[TTS Client] playPreloadedText: scheduling buffer duration=${buffer.duration}s @ t=${nextTime}`)
    const src = audioContext.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = speed
    src.connect(gainNode)
    src.start(nextTime!)
    activeSources.push(src)
    src.onended = () => { activeSources = activeSources.filter(s => s !== src) }
    // advance time by buffer duration adjusted for playbackRate
    nextTime! += buffer.duration / speed
  })
  // wait until playback done
  await waitForPlaybackCompletion()
}

export function stopSpeech() {
  activeSources.forEach(source => {
    try {
      source.stop()
    } catch {}
  })
  activeSources = []
  activeSockets.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close()
    }
  })
  activeSockets = []
  reset()
}

export async function waitForPlaybackCompletion(): Promise<void> {
  return new Promise(resolve => {
    const check = () => {
      if (activeSources.length === 0) resolve()
      else setTimeout(check, 100)
    }
    check()
  })
}

export async function processSegmentClientSideStreaming(
  segmentText: string,
  onFirstChunk?: (actualDuration?: number) => void,
  onProgress?: (progress: { processedText: string, totalProcessed: number, estimatedTotal: number }) => void,
  onStreamingComplete?: (finalDuration: number) => void
): Promise<void> {
  if (!kokoroInstance) {
    console.error("[TTS Client CSS] processSegmentStreaming: Kokoro instance not set.");
    throw new Error("Kokoro instance not set. TTS operations cannot proceed.");
  }

  try {
    if (audioContext.state === "suspended") await audioContext.resume();
    if (nextTime === null) nextTime = audioContext.currentTime;

    console.log(`[TTS Client CSS] processSegmentStreaming started for text length ${segmentText.length}`);

    // Import TextSplitterStream from kokoro-js
    const { TextSplitterStream } = await import('kokoro-js');
    
    // Set up the streaming components with voice and speed
    const splitter = new TextSplitterStream();
    const stream = kokoroInstance.stream(splitter, { voice: currentVoice, speed: currentSpeed });
    
    let firstChunkProcessed = false;
    let totalDuration = 0;
    let processedCharacters = 0;
    const totalCharacters = segmentText.length;
    
    // Process the audio stream
    const streamProcessor = (async () => {
      let segmentIndex = 0;
      for await (const { text, phonemes, audio } of stream) {
        console.log(`[TTS Client CSS] Processing segment ${segmentIndex}: "${text.substring(0, 50)}..."`);
        
        // Convert audio to AudioBuffer using the current voice and speed
        const audioBlob = audio.toBlob();
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Call onFirstChunk for the first segment
        if (!firstChunkProcessed) {
          firstChunkProcessed = true;
          if (onFirstChunk) {
            // For streaming, pass the duration of the first chunk as initial estimate
            onFirstChunk(audioBuffer.duration);
          }
        }
        
        // Schedule audio playback
        if (nextTime! < audioContext.currentTime) nextTime = audioContext.currentTime;
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNode);
        source.start(nextTime!);

        activeSources.push(source);
        source.onended = () => {
          activeSources = activeSources.filter(s => s !== source);
        };
        nextTime! += audioBuffer.duration;
        totalDuration += audioBuffer.duration;
        
        // Update progress
        processedCharacters += text.length;
        if (onProgress) {
          onProgress({
            processedText: text,
            totalProcessed: processedCharacters,
            estimatedTotal: totalCharacters
          });
        }
        
        console.log(`[TTS Client CSS] Segment ${segmentIndex} scheduled: duration=${audioBuffer.duration}s, total=${totalDuration}s`);
        segmentIndex++;
      }
      
      console.log(`[TTS Client CSS] Streaming complete: total duration=${totalDuration}s, segments=${segmentIndex}`);
      
      // Notify that streaming is complete with the final duration
      if (onStreamingComplete) {
        onStreamingComplete(totalDuration);
      }
    })();
    
    // Feed text to the splitter
    // Split text into tokens (words) for gradual feeding
    const tokens = segmentText.match(/\s*\S+/g) || [];
    console.log(`[TTS Client CSS] Feeding ${tokens.length} tokens to splitter`);
    
    for (const token of tokens) {
      splitter.push(token);
      // Small delay to simulate streaming input (can be adjusted or removed)
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    
    // Close the splitter to signal end of input
    splitter.close();
    
    // Wait for all audio processing to complete
    await streamProcessor;
    
    // Wait for playback to complete
    await waitForPlaybackCompletion();
    
  } catch (error) {
    console.error("[TTS Client CSS] Error in processSegmentClientSideStreaming:", error);
    throw error;
  }
}