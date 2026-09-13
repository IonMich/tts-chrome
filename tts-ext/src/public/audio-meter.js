// Observes audio actually rendered into the output graph, not synthesis arrival.
class ReaderMeter extends AudioWorkletProcessor {
  constructor() { super(); this.heard = false; }
  process(inputs, outputs) {
    const input = inputs[0] || [], output = outputs[0];
    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel] || input[0];
      if (source) output[channel].set(source);
    }
    if (!this.heard && input[0]) {
      const offset = input[0].findIndex(sample => Math.abs(sample) > 0.00001);
      if (offset >= 0) {
        this.heard = true;
        this.port.postMessage({ type: 'first-rendered-sound', contextTime: (currentFrame + offset) / sampleRate });
      }
    }
    return true;
  }
}
registerProcessor('reader-meter', ReaderMeter);
