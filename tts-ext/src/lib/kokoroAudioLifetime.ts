import { RawAudio, Tensor } from '@huggingface/transformers';

interface KokoroInputs {
  input_ids: Tensor;
  style: Tensor;
  speed: Tensor;
}

type RunKokoroModel = (inputs: KokoroInputs) => Promise<{ waveform?: Tensor }>;

/** Run one local Kokoro inference and release every tensor created by this call. */
export async function generateLocalVoiceAudio(
  runModel: RunKokoroModel,
  inputIds: Tensor,
  styleData: Float32Array,
  speed: number,
) {
  let style: Tensor | undefined;
  let speedInput: Tensor | undefined;
  let waveform: Tensor | undefined;
  try {
    style = new Tensor('float32', styleData, [1, 256]);
    speedInput = new Tensor('float32', [speed], [1]);
    const result = await runModel({ input_ids: inputIds, style, speed: speedInput });
    waveform = result.waveform;
    if (!waveform) throw new Error('The voice returned no audio.');
    const samples = waveform.data;
    if (!(samples instanceof Float32Array)) throw new Error('The voice returned invalid audio.');
    // ORT's CPU tensor disposal drops the wrapper's reference but does not detach
    // this array. RawAudio owns it until the worker transfers it to the reader.
    return new RawAudio(samples, 24_000);
  } finally {
    waveform?.dispose();
    speedInput?.dispose();
    style?.dispose();
    // inputIds belongs to the caller of Kokoro's public generate_from_ids API.
  }
}
