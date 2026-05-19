#!/usr/bin/env node
// Render the Packing List app icon set from assets/icon.svg to PNG.
//
// Outputs (1024x1024 unless noted):
//   assets/icon.png           — iOS App Store + iOS home screen source. RGBA,
//                               transparent rounded corners (Expo flattens it).
//   assets/adaptive-icon.png  — Android adaptive foreground. Full-bleed copy of
//                               icon.png; app.json composites it over the paper
//                               `backgroundColor` and the OS applies the mask.
//   assets/splash-icon.png    — splash image. Full-bleed copy; app.json sets the
//                               paper `backgroundColor` behind it.
//   assets/favicon.png (48)   — web favicon.
//   ios/PackingList/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png
//                             — RGB, NO alpha (App Store requirement). The
//                               transparent corners are flattened over white,
//                               reproducing what `expo prebuild` does so this
//                               file stays in sync without a full prebuild.
//
// `assets/icon.svg` is the single source of truth for the glyph. The geometry
// there is vertically centered (equal top/bottom padding) — see that file's
// comment. Edit the SVG, then re-run this script. Do not hand-edit the PNGs.
//
// Renders via the user's installed Chrome (headless) — same zero-npm-dep
// approach as scripts/render-screenshots.mjs; no native `sharp` in the RN
// install graph. Requires `pngjs` (present transitively via the Expo
// toolchain; if a future prune removes it, `npm install --no-save pngjs`).
//
// Run from the packing-list repo root:  node scripts/build-icon.mjs

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { findChrome } from './lib/find-chrome.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(repoRoot, 'assets');
const iosIconPath = path.join(
  repoRoot,
  'ios/PackingList/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png',
);

const SIZE = 1024;
const FAVICON_SIZE = 48;
// iOS App Store icons must carry no alpha channel. Expo's prebuild flattens
// the SVG's transparent rounded corners over white; match that exactly.
const IOS_FLATTEN_BG = '#FFFFFF';

const svgSource = fs.readFileSync(path.join(assetsDir, 'icon.svg'), 'utf8');

function wrapHtml(size) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:transparent;}
    svg{display:block;width:${size}px;height:${size}px;}
  </style></head><body>${svgSource}</body></html>`;
}

function renderPng(size, outPath) {
  const tmpHtml = path.join(
    os.tmpdir(),
    `packing-list-icon-${Date.now()}-${Math.random().toString(36).slice(2)}.html`,
  );
  fs.writeFileSync(tmpHtml, wrapHtml(size), 'utf8');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-sandbox',
    '--force-device-scale-factor=1',
    `--window-size=${size},${size}`,
    '--default-background-color=00000000',
    `--screenshot=${outPath}`,
    '--virtual-time-budget=2000',
    pathToFileURL(tmpHtml).href,
  ];
  const result = spawnSync(findChrome(), args, { stdio: 'pipe' });
  fs.rmSync(tmpHtml, { force: true });
  if (result.status !== 0 || !fs.existsSync(outPath)) {
    throw new Error(`Chrome failed (${result.status}): ${result.stderr?.toString() || ''}`);
  }
}

// Composite an RGBA PNG onto a solid background and drop the alpha channel,
// producing an RGB (colorType 2) PNG with no alpha.
function stripAlpha(pngPath, bgHex) {
  const png = PNG.sync.read(fs.readFileSync(pngPath));
  const br = parseInt(bgHex.slice(1, 3), 16);
  const bg = parseInt(bgHex.slice(3, 5), 16);
  const bb = parseInt(bgHex.slice(5, 7), 16);
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3] / 255;
    png.data[i] = Math.round(png.data[i] * a + br * (1 - a));
    png.data[i + 1] = Math.round(png.data[i + 1] * a + bg * (1 - a));
    png.data[i + 2] = Math.round(png.data[i + 2] * a + bb * (1 - a));
    png.data[i + 3] = 255;
  }
  fs.writeFileSync(
    pngPath,
    PNG.sync.write(png, { colorType: 2, inputColorType: 6, inputHasAlpha: true }),
  );
}

function build() {
  fs.mkdirSync(assetsDir, { recursive: true });

  const iconPng = path.join(assetsDir, 'icon.png');
  const adaptivePng = path.join(assetsDir, 'adaptive-icon.png');
  const splashPng = path.join(assetsDir, 'splash-icon.png');
  const faviconPng = path.join(assetsDir, 'favicon.png');

  console.log('Rendering icon.png / adaptive-icon.png / splash-icon.png (RGBA)...');
  renderPng(SIZE, iconPng);
  fs.copyFileSync(iconPng, adaptivePng);
  fs.copyFileSync(iconPng, splashPng);
  console.log('  assets/icon.png');
  console.log('  assets/adaptive-icon.png');
  console.log('  assets/splash-icon.png');

  console.log('Rendering favicon.png (48, RGBA)...');
  renderPng(FAVICON_SIZE, faviconPng);
  console.log('  assets/favicon.png');

  console.log('Writing iOS AppIcon (no alpha, flattened over white)...');
  fs.copyFileSync(iconPng, iosIconPath);
  stripAlpha(iosIconPath, IOS_FLATTEN_BG);
  console.log(`  ${path.relative(repoRoot, iosIconPath)}`);

  console.log('\nDone.');
}

build();
