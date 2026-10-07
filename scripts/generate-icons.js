#!/usr/bin/env node
// scripts/generate-icons.js
// Writes simple placeholder PNG icons to icons/ at the repo root.
// Replace with real branded icons before shipping to production.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Target: <repo-root>/icons   (script lives in <repo-root>/scripts)
const ICON_DIR = resolve(__dirname, '..', 'icons');

if (!existsSync(ICON_DIR)) {
  mkdirSync(ICON_DIR, { recursive: true });
  console.log('Created folder:', ICON_DIR);
}

/**
 * Minimal valid 2x2 teal PNG (base64).
 * Decoded, this is a tiny solid-color PNG that all browsers render fine.
 */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAlawQBiY3L7wAAAABJRU5ErkJggg==';

const files = ['icon-192x192.png', 'icon-512x512.png', 'apple-touch-icon.png', 'favicon-96x96.png'];

let written = 0;
for (const name of files) {
  const fullPath = resolve(ICON_DIR, name);
  try {
    writeFileSync(fullPath, Buffer.from(PNG_BASE64, 'base64'));
    console.log('✓', 'icons/' + name);
    written++;
  } catch (err) {
    console.error('✗ Failed:', name, '-', err.message);
  }
}

console.log(`\nWrote ${written}/${files.length} files to icons/`);
if (written === files.length) {
  console.log('Placeholder icons ready. Replace before shipping.');
} else {
  process.exit(1);
}
