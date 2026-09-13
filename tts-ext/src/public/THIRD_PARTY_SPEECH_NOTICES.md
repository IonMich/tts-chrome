# Third-party speech components

This notice records the speech components used by the local review build. It does not replace their full license texts or the notices for the extension's UI dependencies.

## Kokoro v1.0 weights and voice files

Kokoro was released by hexgrad; the ONNX conversion is published by ONNX Community. The pinned model repository declares **Apache License 2.0**:

https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/blob/468588286ebb2dd77c25b9771e5d165896538cce/README.md

The full-precision `onnx/model.onnx` in that revision is used. Its published SHA256 matches the retained local asset. The nine retained voice files are listed in the asset manifest; the build does not claim that all models elsewhere named Kokoro share this exact provenance.

## JavaScript generation and inference

- **kokoro-js 1.2.1**, hexgrad/Xenova and contributors: Apache-2.0. Source: https://github.com/hexgrad/kokoro/tree/main/kokoro.js . Installed package license: `node_modules/kokoro-js/LICENSE`.
- **Transformers.js 3.5.1**, Hugging Face and contributors: Apache-2.0. Source: https://github.com/huggingface/transformers.js/tree/3.5.1 . Installed package license: `node_modules/@huggingface/transformers/LICENSE`.
- **ONNX Runtime Web 1.26.0**, Microsoft and contributors: MIT. Source revision: https://github.com/microsoft/onnxruntime/tree/v1.26.0 . Preserve ONNX Runtime's applicable third-party notices as well as its MIT license. Local WASM/JavaScript assets must come from the same package build.

## Phonemizer and embedded eSpeak NG

**phonemizer 1.2.1**, Xenova, declares Apache-2.0 for its JavaScript wrapper. Published npm metadata identifies source commit `6835144b7ee9043129222549c1ed2f6a27216278`:

https://github.com/xenova/phonemizer.js/tree/6835144b7ee9043129222549c1ed2f6a27216278

The package also includes a generated **eSpeak NG engine and language data**. The wrapper's Apache declaration must not be used to relabel those components. eSpeak NG is released under **GNU GPL version 3 or later**, and is based on eSpeak by Jonathan Duddington. Primary source/license information:

- https://github.com/espeak-ng/espeak-ng
- https://github.com/espeak-ng/espeak-ng/blob/master/COPYING
- https://github.com/xenova/phonemizer.js/blob/6835144b7ee9043129222549c1ed2f6a27216278/src/espeakng.worker.js

The exact upstream eSpeak NG source revision and reproducible engine/data build instructions were **not identified** in the inspected phonemizer package. The wrapper source link alone is therefore not asserted to be the complete corresponding source of the generated engine. This is a provenance inventory for the local review, with the available licenses and attributions preserved; it does not determine the license of the combined extension or supply an invented source offer.

Full GPL text captured from the primary eSpeak NG repository is available as `licenses/espeak-ng-GPL-3.0.txt` beside this review. Full Apache text is preserved from the installed package as `licenses/Apache-2.0.txt`. Neither license text was modified.

## Mediabunny 1.56.0

The encoded streaming playback controller uses unmodified Mediabunny modules, under Mozilla Public License 2.0, for Opus encoding through browser WebCodecs and append-only WebM muxing. Source: https://github.com/Vanilagy/mediabunny/tree/v1.56.0 . Exact installed source is available in `node_modules/mediabunny`; the license is included in `licenses/mediabunny-MPL-2.0.txt`. No model weights are supplied by this dependency.
