import { copyFile, mkdir, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
const assets = ['index.html', 'styles.css', 'script.js', 'editor-core.js'];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(assets.map((file) => copyFile(new URL(file, root), new URL(file, output))));

console.log(`Built ${assets.length} static assets in dist/ for Cloudflare Pages.`);
