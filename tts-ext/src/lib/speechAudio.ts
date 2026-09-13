/** Remove only quiet padding around a clip; retain consonant attack/release margins. */
export function trimSpeechPadding(samples: Float32Array, sampleRate: number, text = '') {
  const threshold = 0.0001;
  let first = 0, last = samples.length - 1;
  while (first < samples.length && Math.abs(samples[first]) <= threshold) first++;
  while (last > first && Math.abs(samples[last]) <= threshold) last--;
  if (first >= last || !Number.isFinite(sampleRate) || sampleRate <= 0) return { samples, removedStartSec: 0, removedEndSec: 0 };
  const start = Math.max(0, first - Math.round(sampleRate * 0.08));
  const tailSec = /\n\s*$/.test(text) ? 0.35 : /[.!?…]["'”’)\]]*\s*$/.test(text) ? 0.22 : /[;:,]["'”’)\]]*\s*$/.test(text) ? 0.14 : 0.10;
  const end = Math.min(samples.length, last + 1 + Math.round(sampleRate * tailSec));
  return { samples: samples.subarray(start, end), removedStartSec: start / sampleRate, removedEndSec: (samples.length - end) / sampleRate };
}
