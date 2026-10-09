#!/usr/bin/env node
// scripts/generate-icons.js
// Rasterizes icons/logo.svg into PNG icons at various sizes.
// Re-run whenever you update logo.svg.
//
//   npm run icons

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ICONS_DIR = resolve(ROOT, 'icons');
const LOGO_SVG = resolve(ICONS_DIR, 'logo.svg');

// Ensure the icons dir exists
if (!existsSync(ICONS_DIR)) mkdirSync(ICONS_DIR, { recursive: true });

// Ensure the logo exists
if (!existsSync(LOGO_SVG)) {
  console.error('✗ Missing icons/logo.svg — create it first.');
  process.exit(1);
}

// Target sizes for different platforms
const TARGETS = [
  { file: 'icon-192x192.png', size: 192 },
  { file: 'icon-512x512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-96x96.png', size: 96 },
  { file: 'favicon-32x32.png', size: 32 },
  { file: 'favicon-16x16.png', size: 16 },
  { file: 'maskable-512x512.png', size: 512 }, // for PWA maskable icon
];

// Read the SVG once
const svgBuffer = readFileSync(LOGO_SVG);

async function main() {
  console.log('Generating icons from icons/logo.svg…\n');

  let success = 0;

  for (const { file, size } of TARGETS) {
    const target = resolve(ICONS_DIR, file);
    try {
      await sharp(svgBuffer, { density: 384 }) // high density = crisp rasterization
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toFile(target);

      const bytes = readFileSync(target).length;
      console.log(`✓ icons/${file}  (${size}×${size}, ${formatBytes(bytes)})`);
      success++;
    } catch (err) {
      console.error(`✗ icons/${file} — ${err.message}`);
    }
  }

  console.log(`\nWrote ${success}/${TARGETS.length} files.`);
  if (success === TARGETS.length) {
    console.log('Run `git add icons/` and commit to update the app icons.');
  } else {
    process.exit(1);
  }
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
