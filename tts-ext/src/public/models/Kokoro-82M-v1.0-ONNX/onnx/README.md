# ONNX model asset

Install or verify `model.onnx` through the repository's pinned asset workflow:

```sh
npm run prepare:assets
```

`tts-ext/assets-manifest.json` fixes the exact upstream revision, byte size and
SHA-256 digest. `scripts/prepare-assets.mjs` verifies an existing file or downloads
that pinned revision to a temporary path, validates it, and only then moves it here.
Do not replace it with an unpinned download from an upstream `main` branch.
The 325 MB model file is intentionally ignored by Git.
