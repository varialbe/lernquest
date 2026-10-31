#!/usr/bin/env node
/** Leitet aus assets-src/app-icon.png alle App-Icons ab (PWA, Apple-Touch, maskable, iOS-AppIcon). */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'assets-src/app-icon.png');
if (!existsSync(src)) throw new Error('assets-src/app-icon.png fehlt – erst `pnpm assets` ausführen');
mkdirSync(resolve(root, 'public/app-icons'), { recursive: true });

const out = (p) => resolve(root, p);
await sharp(src).resize(192, 192).png({ palette: true, quality: 90 }).toFile(out('public/app-icons/icon-192.png'));
await sharp(src).resize(512, 512).png({ palette: true, quality: 90 }).toFile(out('public/app-icons/icon-512.png'));
await sharp(src).resize(180, 180).png().toFile(out('public/apple-touch-icon.png'));
// maskable: Motiv auf 80 % verkleinern (Safe Zone), Rand durch Randpixel fortsetzen (Verlauf bleibt nahtlos)
await sharp(src)
  .resize(410, 410)
  .extend({ top: 51, bottom: 51, left: 51, right: 51, extendWith: 'copy' })
  .png()
  .toFile(out('public/app-icons/icon-maskable-512.png'));

const ios = out('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
if (existsSync(resolve(ios, '..'))) {
  await sharp(src).resize(1024, 1024).flatten({ background: '#7c5cff' }).removeAlpha().png().toFile(ios);
  console.log('iOS-AppIcon aktualisiert');
}
console.log('Icons erzeugt');
