#!/usr/bin/env node
// scripts/check-env.js
// Sanity check: Node version, folder structure, required files.
// Run with: npm run check-env

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const MIN_NODE = 18;

const errors = [];
const warnings = [];
const ok = [];

// ---------- 1. Node version ----------
const major = Number(process.versions.node.split('.')[0]);
if (major < MIN_NODE) {
  errors.push(`Node ${process.versions.node} found — need v${MIN_NODE}+. Upgrade at nodejs.org.`);
} else {
  ok.push(`Node v${process.versions.node}`);
}

// ---------- 2. Required files ----------
const required = [
  'package.json',
  'index.html',
  'landing.html',
  'auth.html',
  'admin.html',
  'src/main.js',
  'src/api/client.js',
  'src/state/store.js',
  'src/ui/nav.js',
  'src/ui/toast.js',
];

for (const f of required) {
  if (existsSync(resolve(ROOT, f))) ok.push(`✓ ${f}`);
  else errors.push(`✗ missing ${f}`);
}

// ---------- 3. Recommended files ----------
const recommended = [
  'styles/main.css',
  'sw.js',
  'manifest.webmanifest',
  'backend/Code.gs',
  'icons/icon-192x192.png',
];

for (const f of recommended) {
  if (!existsSync(resolve(ROOT, f))) warnings.push(`⚠ missing ${f}`);
}

// ---------- 4. Placeholder detection ----------
const placeholders = [
  ['auth.html', 'YOUR_GOOGLE_CLIENT_ID'],
  ['src/api/client.js', 'YOUR_DEPLOYMENT_ID'],
];

for (const [file, marker] of placeholders) {
  const path = resolve(ROOT, file);
  if (!existsSync(path)) continue;
  const content = readFileSync(path, 'utf8');
  if (content.includes(marker)) {
    warnings.push(`⚠ ${file} still contains placeholder: ${marker}`);
  }
}

// ---------- 5. Report ----------
console.log('\nCVQ Hub — environment check\n');

console.log('✅ OK:');
ok.forEach((line) => console.log('   ' + line));

if (warnings.length) {
  console.log('\n⚠️  Warnings (expected during development):');
  warnings.forEach((line) => console.log('   ' + line));
}

if (errors.length) {
  console.log('\n❌ Errors (these must be fixed):');
  errors.forEach((line) => console.log('   ' + line));
  process.exit(1);
}

console.log('\nReady. Run: npm run dev\n');
