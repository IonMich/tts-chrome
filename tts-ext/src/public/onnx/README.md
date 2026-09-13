# ort-wasm directory

`npm run prepare:assets` copies and verifies the matching
`ort-wasm-simd-threaded.asyncify.mjs` and `.wasm` files from the pinned
ONNX Runtime 1.26.0 package. The large WASM binary is ignored by Git.
The native WebGPU provider and CPU availability fallback use this matching pair.
