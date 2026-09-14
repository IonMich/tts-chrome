# README preview assets

`reader-preview.png` and `reader-preview-mobile.png` depict the current Kokoro
player and sentence highlighting on a brief attributed excerpt from Dario Amodei’s
[Machines of Loving Grace](https://darioamodei.com/essay/machines-of-loving-grace).
They are documentation scenes with a fixed example playback position, not
recordings or performance measurements. The article excerpt is authentic; the
page composition is an illustration rather than a capture of the author's site.

The scene imports `ReaderPlayer`, `captureReadingSource` and `SourceHighlight`
directly from the extension. Player styling, labels and highlight painting come
from those production modules. Only the article layout and framing are defined
here. The player is enlarged for legibility at README width.

To reproduce after installing the extension's development dependencies, run from
the repository root with an existing Playwright installation and Chromium:

```sh
READER_PLAYWRIGHT=/path/to/playwright/index.mjs \
READER_CHROME=/path/to/chromium \
node docs/assets/render-reader-preview.mjs
```

If Playwright and its browser are already resolvable, the environment variables
can be omitted. The renderer creates a temporary local HTTP server and a fresh
headless browser, then closes both. It never loads audio, speech models, the
installed extension or the native helper.

Use the mobile image below 600 CSS pixels through a README `<picture>` element.
Both are static PNGs and need no motion alternative.
