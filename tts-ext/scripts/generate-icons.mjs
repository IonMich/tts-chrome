// Regenerate Chrome's raster icons from the editable source mark.
// Run with the extension's installed development dependencies.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/assets/icon.svg', import.meta.url));
const sizes = [16, 24, 32, 48, 96, 128];

for (const size of sizes) {
  const destination = fileURLToPath(new URL(`../src/public/icon/${size}.png`, import.meta.url));
  await sharp(source, { density: 384 }).resize(size, size).png().toFile(destination);
  console.log(`Generated icon/${size}.png`);
}
