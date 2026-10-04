import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

let server;
let browser;
let url;
before(async () => {
  server = createServer(async (request, response) => {
    const path = request.url === '/' ? 'index.html' : request.url.slice(1);
    if (!['index.html', 'script.js', 'editor-core.js', 'styles.css'].includes(path)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(await readFile(new URL(`../${path}`, import.meta.url)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function pageFor(t, markup, init) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  if (init) await page.addInitScript(init);
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('html-source').value.includes('Start editing'));
  if (markup !== undefined) await page.locator('#html-source').fill(markup);
  t.after(async () => {
    assert.deepEqual(errors, [], 'no uncaught application errors');
    await page.close();
  });
  return page;
}

async function liveSelect(page, selector, start = 0, end, endSelector = selector) {
  await page.evaluate(({ selector, start, end, endSelector }) => {
    const doc = document.getElementById('editor-frame').contentDocument;
    const editor = doc.getElementById('editor');
    const first = editor.querySelector(selector).firstChild;
    const last = editor.querySelector(endSelector).firstChild;
    editor.focus();
    const range = doc.createRange();
    range.setStart(first, start);
    range.setEnd(last, end ?? last.length);
    doc.getSelection().removeAllRanges();
    doc.getSelection().addRange(range);
    doc.dispatchEvent(new Event('selectionchange'));
  }, { selector, start, end, endSelector });
}
async function color(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
const html = (page) => page.locator('#html-source').inputValue();
async function sourceSelect(page, start, end) {
  await page.locator('#html-source').focus();
  await page.locator('#html-source').evaluate((input, [start, end]) => {
    input.setSelectionRange(start, end);
    input.dispatchEvent(new Event('select'));
  }, [start, end]);
}

test('live formatting remains selection-scoped, clears correctly, and supports undo/redo', async (t) => {
  const page = await pageFor(t, '<p><span style="color:red;font-weight:bold">hello world</span></p>');
  await liveSelect(page, 'span', 0, 5);
  await color(page, 'text-color', '#0000ff');
  const styled = await html(page);
  assert.match(styled, /color: rgb\(0, 0, 255\)/);
  assert.match(styled, /color: red/);
  await page.locator('[data-cmd="undo"]').click();
  assert.equal(await html(page), '<p><span style="color:red;font-weight:bold">hello world</span></p>');
  await page.locator('[data-cmd="redo"]').click();
  assert.equal(await html(page), styled);
  await liveSelect(page, 'span', 0, 5);
  await page.locator('#text-color-none').click();
  assert.doesNotMatch(await html(page), /color: rgb\(0, 0, 255\)/);
  assert.match(await html(page), /font-weight: bold/);
});

test('cross-block styles preserve paragraphs and repeated changes do not accumulate spans', async (t) => {
  const page = await pageFor(t, '<p>hello</p><p>world</p>');
  await liveSelect(page, 'p:first-child', 1, 3, 'p:last-child');
  await page.locator('#font-size').selectOption('5');
  await page.locator('#font-size').selectOption('6');
  const result = await page.frameLocator('#editor-frame').locator('#editor').evaluate((root) => ({
    paragraphs: [...root.children].map((p) => p.textContent),
    spans: root.querySelectorAll('span').length,
    invalid: !!root.querySelector('span p'),
  }));
  assert.deepEqual(result, { paragraphs: ['hello', 'world'], spans: 2, invalid: false });
});

test('source color picker updates the same selection without adding placeholder text', async (t) => {
  const page = await pageFor(t, '<p>hello world</p>');
  await sourceSelect(page, 3, 8);
  await color(page, 'text-color', '#ff0000');
  await color(page, 'text-color', '#0000ff');
  const output = await html(page);
  assert.doesNotMatch(output, />text</);
  assert.doesNotMatch(output, /red/);
  assert.equal((output.match(/<span/g) || []).length, 1);
  assert.equal(await page.frameLocator('#editor-frame').locator('#editor').textContent(), 'hello world');
});

test('source block and unlink commands work and reject selections inside attributes', async (t) => {
  const page = await pageFor(t, '<p><a href="https://example.com">hello</a></p>');
  const original = await html(page);
  await sourceSelect(page, original.indexOf('hello'), original.indexOf('hello') + 5);
  await page.locator('#remove-link').click();
  assert.doesNotMatch(await html(page), /<a/);
  await sourceSelect(page, 0, (await html(page)).length);
  await page.locator('#block-type').selectOption('H2');
  assert.equal(await html(page), '<h2>hello</h2>');
  await page.locator('#html-source').fill('<p style="color:red">hello</p>');
  await sourceSelect(page, 10, 15);
  await color(page, 'text-color', '#0000ff');
  assert.equal(await html(page), '<p style="color:red">hello</p>');
  assert.match(await page.locator('#save-status').textContent(), /not part of a tag/);
});

test('default font size preserves bold and color', async (t) => {
  const page = await pageFor(t, '<p><span style="font-size:24px;font-weight:bold;color:red">hello</span></p>');
  await liveSelect(page, 'span');
  await page.locator('#font-size').selectOption('');
  assert.doesNotMatch(await html(page), /font-size/);
  assert.match(await html(page), /font-weight: bold/);
  assert.match(await html(page), /color: red/);
});

test('custom size live updates keep input focus and preserve the selected text', async (t) => {
  const page = await pageFor(t, '<p>hello world</p>');
  await liveSelect(page, 'p', 0, 5);
  await page.locator('#custom-size-value').fill('25');
  await page.waitForFunction(() => document.getElementById('html-source').value.includes('font-size: 25px'));
  assert.equal(await page.locator('#custom-size-value').evaluate((input) => document.activeElement === input), true);
  await page.locator('#custom-size-value').fill('30');
  await page.locator('#apply-custom-size').click();
  const output = await html(page);
  assert.equal((output.match(/<span/g) || []).length, 1);
  assert.match(output, /font-size: 30px/);
  assert.match(output, /hello<\/span> world/);
});

test('table edits preserve spans, cleared backgrounds and clean exported markup', async (t) => {
  const page = await pageFor(t, '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr><tr><td>E</td><td>F</td></tr></tbody></table>');
  await page.locator('.table-section').evaluate((details) => { details.open = true; });
  await page.frameLocator('#editor-frame').locator('td').first().click();
  await page.locator('#table-merge-down').click();
  await page.locator('#table-merge-down').click();
  assert.match(await html(page), /A<br>C<br>E/);
  assert.doesNotMatch(await html(page), /data-editor-selected|is-selected/);
  await page.locator('#table-bg-none').click();
  await page.locator('#table-cell-padding').fill('12');
  assert.equal(await page.frameLocator('#editor-frame').locator('table').evaluate((table) => table.style.backgroundColor), '');
  const before = await html(page);
  await page.locator('#table-split-cell').click();
  assert.equal(await page.frameLocator('#editor-frame').locator('td').count(), 6);
  await page.locator('[data-cmd="undo"]').click();
  assert.equal(await html(page), before);
});

test('styles and event handlers are isolated; document headings use document styles', async (t) => {
  const page = await pageFor(t, '<style>body { background: rgb(255, 0, 0); } button { display:none }</style><h2>Heading</h2><img src="/missing" onerror="parent.document.body.dataset.executed=1">');
  assert.equal(await page.locator('#copy-html').isVisible(), true);
  await page.waitForFunction(() => document.getElementById('editor-frame').contentDocument.querySelector('img').complete);
  assert.equal(await page.locator('body').getAttribute('data-executed'), null);
  const heading = await page.frameLocator('#editor-frame').locator('h2').evaluate((h2) => ({
    fontSize: getComputedStyle(h2).fontSize, padding: getComputedStyle(h2).padding,
  }));
  assert.deepEqual(heading, { fontSize: '24px', padding: '0px' });
});

test('source unlink and Clear Format affect only the selected part of a styled link', async (t) => {
  const page = await pageFor(t, '<p><a href="https://example.com"><strong><span style="color:red">hello world</span></strong></a></p>');
  let output = await html(page);
  await sourceSelect(page, output.indexOf('hello'), output.indexOf('hello') + 5);
  await page.locator('#remove-link').click();
  const links = page.frameLocator('#editor-frame').locator('a');
  assert.equal(await links.count(), 1);
  assert.equal(await links.textContent(), ' world');
  assert.match(await html(page), /<strong>/);
  output = await html(page);
  await sourceSelect(page, output.indexOf('hello'), output.indexOf('hello') + 5);
  await page.locator('[data-cmd="removeFormat"]').click();
  assert.equal(await page.frameLocator('#editor-frame').locator('strong').textContent(), ' world');
  assert.equal(await page.frameLocator('#editor-frame').locator('#editor').textContent(), 'hello world');
});

test('image style changes preserve other properties, frame markup round-trips and edits undo', async (t) => {
  const page = await pageFor(t, '<p>before<img alt="sample" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" style="width:40px;height:30px;display:inline-block">after</p>');
  await page.frameLocator('#editor-frame').locator('img').click();
  await page.locator('#image-padding').fill('5');
  const styled = await html(page);
  assert.match(styled, /height: 30px/);
  assert.match(styled, /display: inline-block/);
  assert.doesNotMatch(styled, /data-editor-selected|is-selected/);
  await page.locator('#wrap-image').click();
  const wrapped = await html(page);
  assert.match(wrapped, /<span class="image-frame" style=/);
  await page.locator('[data-cmd="undo"]').click();
  assert.equal(await html(page), styled);
  await page.locator('[data-cmd="redo"]').click();
  assert.equal(await html(page), wrapped);
  await page.locator('#html-source').fill(wrapped + ' ');
  assert.equal(await page.frameLocator('#editor-frame').locator('p').count(), 1);
  assert.equal(await page.frameLocator('#editor-frame').locator('p').textContent(), 'beforeafter');
});

test('empty documents persist and a new edit after undo discards the redo branch', async (t) => {
  const page = await pageFor(t, '<p>first</p>');
  await page.locator('#html-source').fill('<p>second</p>');
  await page.keyboard.press('Control+z');
  assert.equal(await html(page), '<p>first</p>');
  await page.locator('#html-source').fill('<p>third</p>');
  assert.equal(await page.locator('[data-cmd="redo"]').isDisabled(), true);
  await page.locator('#clear-editor').click();
  await page.keyboard.press('Control+s');
  await page.reload();
  await page.waitForFunction(() => document.getElementById('save-status').textContent === 'Loaded from local storage');
  assert.equal(await html(page), '');
  assert.equal(await page.frameLocator('#editor-frame').locator('#editor').textContent(), '');
});

const testImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
async function imageField(page, id, value) {
  await page.locator(`#${id}`).fill(value);
  await page.locator(`#${id}`).press('Enter');
}

test('image dimensions and min/max constraints update independently and reject invalid CSS', async (t) => {
  const page = await pageFor(t, `<p><img src="${testImage}" style="width:40px;height:30px;max-width:80%;padding:3px"></p>`);
  const image = page.frameLocator('#editor-frame').locator('img');
  await image.click();
  await page.locator('.image-advanced').evaluate((details) => { details.open = true; });
  await imageField(page, 'image-max-width', 'none');
  await imageField(page, 'image-width-value', '120');
  await imageField(page, 'image-height', '75px');
  await imageField(page, 'image-min-width', '20px');
  await imageField(page, 'image-min-height', '10px');
  await imageField(page, 'image-max-height', '200px');
  await page.locator('#image-fit').selectOption('cover');
  await imageField(page, 'image-object-position', '25% 75%');
  assert.deepEqual(await image.evaluate((img) => ({
    width: img.style.width, height: img.style.height, maxWidth: img.style.maxWidth,
    minWidth: img.style.minWidth, minHeight: img.style.minHeight, maxHeight: img.style.maxHeight,
    padding: img.style.padding, fit: img.style.objectFit, position: img.style.objectPosition,
  })), { width: '120px', height: '75px', maxWidth: 'none', minWidth: '20px', minHeight: '10px', maxHeight: '200px', padding: '3px', fit: 'cover', position: '25% 75%' });
  const before = await html(page);
  await imageField(page, 'image-max-width', '-5px');
  assert.equal(await html(page), before);
  assert.match(await page.locator('#save-status').textContent(), /Invalid image max-width/);
  await imageField(page, 'image-max-width', '60%');
  assert.equal(await image.evaluate((img) => img.style.maxWidth), '60%');
  await page.locator('[data-cmd="undo"]').click();
  assert.equal(await html(page), before);
  await page.locator('[data-cmd="redo"]').click();
  assert.equal(await image.evaluate((img) => img.style.maxWidth), '60%');
  await imageField(page, 'image-height', 'auto');
  await imageField(page, 'image-max-width', '');
  assert.equal(await image.evaluate((img) => img.style.height), 'auto');
  assert.equal(await image.evaluate((img) => img.style.maxWidth), '');
});

test('image margins, borders, float and metadata serialize cleanly and reset predictably', async (t) => {
  const page = await pageFor(t, `<p><img src="${testImage}" style="width:40px;height:30px"></p>`);
  const image = page.frameLocator('#editor-frame').locator('img');
  await image.click();
  await page.locator('.image-advanced').evaluate((details) => { details.open = true; });
  await imageField(page, 'image-margin', '8px 12px');
  await imageField(page, 'image-border-width', '2');
  await page.locator('#image-border-style').selectOption('solid');
  await imageField(page, 'image-border-color', '#ff0000');
  await page.locator('#image-float').selectOption('right');
  await page.locator('#image-vertical-align').selectOption('middle');
  await imageField(page, 'image-alt', 'A "quoted" <description>');
  await imageField(page, 'image-title', 'Example image');
  await page.locator('#image-loading').selectOption('lazy');
  assert.deepEqual(await image.evaluate((img) => ({
    margin: img.style.margin, borderWidth: img.style.borderWidth, borderStyle: img.style.borderStyle,
    borderColor: img.style.borderColor, float: img.style.cssFloat,
    verticalAlign: img.style.verticalAlign, alt: img.alt, title: img.title, loading: img.loading,
  })), { margin: '8px 12px', borderWidth: '2px', borderStyle: 'solid', borderColor: 'rgb(255, 0, 0)', float: 'right', verticalAlign: 'middle', alt: 'A "quoted" <description>', title: 'Example image', loading: 'lazy' });
  assert.doesNotMatch(await html(page), /data-editor-selected|is-selected/);
  await page.locator('#image-align').selectOption('center');
  assert.equal(await image.evaluate((img) => img.style.cssFloat), 'none');
  assert.equal(await image.evaluate((img) => img.style.marginLeft), 'auto');
  const beforeReset = await html(page);
  await page.locator('#reset-image-style').click();
  assert.equal(await image.evaluate((img) => img.style.border), '');
  assert.equal(await image.evaluate((img) => img.style.maxWidth), '100%');
  assert.equal(await image.getAttribute('alt'), 'A "quoted" <description>');
  await page.locator('[data-cmd="undo"]').click();
  assert.equal(await html(page), beforeReset);
});

test('switching images clears stale dimension controls without changing either image', async (t) => {
  const page = await pageFor(t, `<p><img id="first" src="${testImage}" style="width:40px;height:30px;max-width:60%;margin:8px"><img id="second" src="${testImage}" width="35" height="25"></p>`);
  await page.frameLocator('#editor-frame').locator('#first').click();
  assert.equal(await page.locator('#image-max-width').inputValue(), '60%');
  const before = await html(page);
  await page.frameLocator('#editor-frame').locator('#second').click();
  assert.equal(await page.locator('#image-max-width').inputValue(), '');
  assert.equal(await page.locator('#image-width-value').inputValue(), '35px');
  assert.equal(await page.locator('#image-margin').inputValue(), '');
  assert.equal(await html(page), before);
});

test('native typing, custom formatting, source edits and Clear share one undo history', async (t) => {
  const page = await pageFor(t, '<p>hello</p>');
  await liveSelect(page, 'p', 5, 5);
  await page.keyboard.type('!');
  assert.equal(await page.frameLocator('#editor-frame').locator('p').textContent(), 'hello!');
  await page.keyboard.press('Control+z');
  assert.equal(await page.frameLocator('#editor-frame').locator('p').textContent(), 'hello');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.frameLocator('#editor-frame').locator('p').textContent(), 'hello!');
  await page.locator('#clear-editor').click();
  assert.equal(await html(page), '');
  await page.locator('[data-cmd="undo"]').click();
  assert.equal(await page.frameLocator('#editor-frame').locator('p').textContent(), 'hello!');
});

test('storage failures are reported without stopping editor initialization or editing', async (t) => {
  const page = await pageFor(t, undefined, () => {
    Storage.prototype.getItem = () => { throw new DOMException('blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  });
  assert.match(await page.locator('#save-status').textContent(), /unavailable/);
  await page.locator('#html-source').fill('<p>still editable</p>');
  await page.keyboard.press('Control+s');
  assert.match(await page.locator('#save-status').textContent(), /Could not save locally/);
  assert.equal(await page.frameLocator('#editor-frame').locator('p').textContent(), 'still editable');
});
