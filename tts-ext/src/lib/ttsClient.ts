import { getWords, splitTextForHybrid } from "./utilsText"

export const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
export const gainNode = audioContext.createGain()
// Log default WebAudio sample rate
console.log(`[TTS Client] WebAudio audioContext.sampleRate: ${audioContext.sampleRate}`)
gainNode.gain.value = 2.0
gainNode.connect(audioContext.destination)

let nextTime: number | null = null
let secondSegmentStarted = false

export let activeSources: AudioBufferSourceNode[] = []
export let activeSockets: WebSocket[] = []
export let currentVoice = 'af_sarah'

export function setCurrentVoice(voice: string) {
  currentVoice = voice
}

export function reset() {
  nextTime = null
  secondSegmentStarted = false
}

export async function processSegment(
  segmentText: string
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
      ws.send(JSON.stringify({ text: segmentText, voice: currentVoice }))
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
        if (!secondSegmentStarted) {
          secondSegmentStarted = true
        }
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