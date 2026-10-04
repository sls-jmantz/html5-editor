import { readFile, readdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
const files = {};
for (const name of (await readdir(output)).sort()) {
  // Stable timestamps keep the ZIP identical when the source has not changed.
  files[name] = [await readFile(new URL(name, output)), { mtime: new Date('2026-01-01T00:00:00Z') }];
}

const archive = zipSync(files, { level: 9 });
await writeFile(new URL('html5-editor-pages.zip', root), archive);
console.log(`Created html5-editor-pages.zip (${archive.length} bytes). Upload this file directly to Cloudflare Pages.`);
