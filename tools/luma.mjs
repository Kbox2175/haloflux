#!/usr/bin/env node
/**
 * Tiny PNG luminance sampler (no dependencies).
 * Used for visual-regression checks: compares the same fractional region
 * across two screenshots.
 *
 * Usage:
 *   node tools/luma.mjs <a.png> [b.png] [x0 y0 x1 y1]  (fractions, default 0 0.1 0.15 0.6)
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported png (depth ${bitDepth}, interlace ${interlace})`);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!bpp) throw new Error(`unsupported color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[rp++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rp++];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = x >= bpp && y > 0 ? out[prevStart + x - bpp] : 0;
      let val;
      switch (ft) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('bad filter ' + ft);
      }
      out[rowStart + x] = val & 255;
    }
  }
  return { w, h, bpp, pixels: out };
}

function stats(img, [x0, y0, x1, y1]) {
  const { w, h, bpp, pixels } = img;
  const ix0 = Math.max(0, Math.floor(x0 * w)), ix1 = Math.min(w, Math.ceil(x1 * w));
  const iy0 = Math.max(0, Math.floor(y0 * h)), iy1 = Math.min(h, Math.ceil(y1 * h));
  const vals = [];
  for (let y = iy0; y < iy1; y += 2) {
    for (let x = ix0; x < ix1; x += 2) {
      const i = (y * w + x) * bpp;
      const r = pixels[i], g = pixels[i + 1] ?? r, b = pixels[i + 2] ?? r;
      vals.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }
  vals.sort((a, b) => a - b);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return {
    mean: +mean.toFixed(2),
    p50: +vals[(vals.length * 0.5) | 0].toFixed(2),
    p95: +vals[(vals.length * 0.95) | 0].toFixed(2),
    max: +vals[vals.length - 1].toFixed(2)
  };
}

const argv = process.argv.slice(2);
if (argv.length < 1) {
  console.error('usage: node tools/luma.mjs <a.png> [b.png] [x0 y0 x1 y1]');
  process.exit(1);
}
// The region is the trailing four numeric args (fractions of the image).
const hasRegion = argv.length >= 5 && argv.slice(-4).every((v) => v !== '' && Number.isFinite(Number(v)));
const region = hasRegion ? argv.slice(-4).map(Number) : [0, 0.1, 0.15, 0.6];
const files = hasRegion ? argv.slice(0, -4) : argv;
for (const f of files) {
  const img = decodePng(f);
  console.log(`${f}  ${img.w}x${img.h}  region[${region.join(',')}]  ${JSON.stringify(stats(img, region))}`);
}
