#!/usr/bin/env node
/**
 * Headless screenshot capture (dev helper, not part of the shipped engine).
 *
 * Usage:
 *   node tools/capture.mjs <url> <out.png> [virtualTimeMs] [width] [height]
 *   node tools/capture.mjs --frames <url> <outPrefix> <t1,t2,...>
 *
 * Notes:
 *  - Chrome is required. Set CHROME env var to override the executable path.
 *  - The flags below are the only combination verified inside this sandbox:
 *    swiftshader + no crash reporter + 1280x720; larger sizes crash the renderer.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHROME = process.env.CHROME || DEFAULT_CHROME;

function capture(url, out, virtualTime = 1500, width = 1280, height = 720) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--allow-file-access-from-files',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${resolve('.chrome-profile2')}`,
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${virtualTime}`,
    `--screenshot=${resolve(out)}`,
    url
  ];
  const r = spawnSync(CHROME, args, { stdio: 'inherit', timeout: 90000 });
  if (!existsSync(out)) throw new Error(`capture failed (exit ${r.status}): ${out}`);
  return out;
}

const argv = process.argv.slice(2);
if (!CHROME || !existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}. Set CHROME=/path/to/chrome.`);
  process.exit(2);
}
if (argv[0] === '--frames') {
  const [, url, prefix, times] = argv;
  for (const t of (times || '1000,2000,3000').split(',')) {
    const out = `${prefix}-${t}.png`;
    console.log(capture(url, out, Number(t)));
  }
} else if (argv.length >= 2) {
  const [url, out, t, w, h] = argv;
  console.log(capture(url, out, Number(t || 1500), Number(w || 1280), Number(h || 720)));
} else {
  console.error('usage: node tools/capture.mjs <url> <out.png> [virtualTimeMs] [w] [h]');
  process.exit(1);
}
