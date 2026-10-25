import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let child;
let origin;
before(async () => {
  child = spawn(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js', 'dev', '--ip', '127.0.0.1', '--port', '0',
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  origin = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Wrangler did not start:\n${output}`)), 30000);
    const fail = (error) => { clearTimeout(timer); reject(error); };
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`Wrangler exited (${code}):\n${output}`)));
    const collect = (data) => {
      output += data;
      const match = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
  });
});

after(async () => {
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') child.kill();
  else process.kill(-child.pid, 'SIGTERM');
  await exited;
});

test('Cloudflare serves the four root assets with no build output', async () => {
  for (const file of ['index.html', 'styles.css', 'script.js', 'editor-core.js']) {
    const response = await fetch(`${origin}/${file === 'index.html' ? '' : file}`);
    assert.equal(response.status, 200, file);
    if (file.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal(await response.text(), await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  }
});

test('Cloudflare does not expose dependencies or repository files as assets', async () => {
  for (const path of [
    'node_modules/workerd/bin/workerd', 'node_modules/jsdom/package.json',
    '.git/config', 'package.json', 'package-lock.json', 'README.md',
    'wrangler.jsonc', 'tests/browser.test.js', '.assetsignore',
  ]) {
    const response = await fetch(`${origin}/${path}`);
    await response.body?.cancel();
    assert.equal(response.status, 404, path);
  }
});
