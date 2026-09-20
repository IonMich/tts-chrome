# README screenshots

The screenshots are rendered from the extension's current React components:

| Asset | View |
|---|---|
| `reader-preview.png` | Desktop article with the player and sentence highlighting |
| `reader-preview-mobile.png` | The same reading on a narrow page |
| `reader-popup.png` | Popup with reading actions, voice portrait and settings |
| `reader-voices.png` | Open voice picker in the page player |

The article previews use a brief attributed excerpt from Dario Amodei’s
[Machines of Loving Grace](https://darioamodei.com/essay/machines-of-loving-grace).
They are documentation scenes with a fixed example playback position, not
recordings or performance measurements. The article excerpt is authentic; the
page composition is an illustration rather than a capture of the author's site.

The scene imports the popup `App`, `ReaderPlayer`, `captureReadingSource` and `SourceHighlight`
directly from the extension. Player styling, labels and highlight painting come
from those production modules. Only the article layout and framing are defined
here. The article player is enlarged for legibility at README width; the popup
and voice picker retain their product dimensions. A documentation-only Chrome
adapter supplies example preferences and a voice catalog without contacting a
native helper. The article's styles are scoped so they cannot restyle the popup.

For a local preview that can be captured with browser tools:

```sh
node docs/assets/render-reader-preview.mjs --serve
```

Open the printed address for the article, `/?view=popup` for the popup, or
`/?view=voices` for the player. Click Nicole's portrait to expand the picker.
The article capture sizes are 1100 × 820 and 440 × 800 CSS pixels; the popup
uses a 416 × 480 viewport and the picker a 380 × 620 viewport. Crop those last
two captures to their padded `.popup-preview` and `.voice-preview` containers.

To regenerate all four PNGs after installing the extension's development dependencies, run from
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

Use the mobile article image below 600 CSS pixels through a README `<picture>`
element. All four assets are static PNGs and need no motion alternative.
