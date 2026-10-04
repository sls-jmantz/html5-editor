import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { editTable, normalizeInline, styleRange, tableGrid } from '../editor-core.js';

function fixture(html) {
  const dom = new JSDOM(`<div id="editor">${html}</div>`);
  return dom.window.document.getElementById('editor');
}
function select(root, node, start = 0, end = node.textContent.length) {
  const range = root.ownerDocument.createRange();
  range.setStart(node.firstChild, start);
  range.setEnd(node.firstChild, end);
  return range;
}
function inherited(node, property) {
  while (node?.nodeType === 1) {
    const value = node.style.getPropertyValue(property);
    if (value) return value;
    node = node.parentElement;
  }
  return '';
}
function textStyles(root, property) {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const result = [];
  while (walker.nextNode()) {
    if (walker.currentNode.textContent) result.push([walker.currentNode.textContent, inherited(walker.currentNode.parentElement, property)]);
  }
  return result;
}

test('partial selection changes only selected text; caret does not restyle a span', () => {
  const root = fixture('<p><span style="color:red">hello world</span></p>');
  styleRange(root, select(root, root.querySelector('span'), 0, 5), 'color', 'blue');
  assert.deepEqual(textStyles(root, 'color'), [['hello', 'blue'], [' world', 'red']]);
  const before = root.innerHTML;
  assert.equal(styleRange(root, select(root, root.querySelector('span'), 0, 0), 'color', 'green'), null);
  assert.equal(root.innerHTML, before);
});

test('old nested declarations do not override new formatting', () => {
  const root = fixture('<p><span style="color:red;font-weight:bold">hello</span> world</p>');
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root.querySelector('p'));
  styleRange(root, range, 'color', 'blue');
  assert.ok(textStyles(root, 'color').every(([, value]) => value === 'blue'));
  assert.equal(inherited(root.querySelector('span'), 'font-weight'), 'bold');
});

test('repeated style changes reuse markup rather than nesting duplicate declarations', () => {
  const root = fixture('<p>hello</p>');
  let range = select(root, root.querySelector('p'));
  for (const value of ['24px', '18px', '32px', '16px']) range = styleRange(root, range, 'font-size', value);
  assert.equal(root.querySelectorAll('span').length, 1);
  assert.equal(root.querySelector('span').style.fontSize, '16px');
  range = styleRange(root, range, 'color', 'red');
  assert.equal(root.querySelectorAll('span').length, 1);
  assert.equal(root.querySelector('span').style.fontSize, '16px');
  assert.equal(root.querySelector('span').style.color, 'red');
});

test('clearing a character-based selection preserves other formatting', () => {
  const root = fixture('<p><span style="color:red;font-weight:bold;font-size:24px">hello world</span></p>');
  styleRange(root, select(root, root.querySelector('span'), 0, 5), 'color', null);
  assert.deepEqual(textStyles(root, 'color'), [['hello', ''], [' world', 'red']]);
  assert.ok(textStyles(root, 'font-weight').every(([, value]) => value === 'bold'));
  assert.ok(textStyles(root, 'font-size').every(([, value]) => value === '24px'));
});

test('normalization preserves whitespace, CSS precedence and quoted semicolons', () => {
  const root = fixture('<p><span style="color:red">hello</span> <span style="color:red">world</span></p><span style="color:red;color:blue;--Label:\'a;b\';padding-left:4px;padding:2px">x</span>');
  normalizeInline(root);
  assert.equal(root.querySelector('p').textContent, 'hello world');
  const span = root.lastChild;
  assert.equal(span.style.color, 'blue');
  assert.equal(span.style.paddingLeft, '2px');
  assert.equal(span.style.getPropertyValue('--Label'), "'a;b'");
});

test('formatting across paragraphs preserves blocks and unrelated text', () => {
  const root = fixture('<p>hello</p><p>world</p>');
  const range = root.ownerDocument.createRange();
  range.setStart(root.firstChild.firstChild, 1);
  range.setEnd(root.lastChild.firstChild, 3);
  styleRange(root, range, 'font-size', '24px');
  assert.deepEqual([...root.children].map((node) => node.tagName), ['P', 'P']);
  assert.deepEqual([...root.children].map((node) => node.textContent), ['hello', 'world']);
  assert.equal(root.querySelector('span p'), null);
  assert.deepEqual(textStyles(root, 'font-size'), [['h', ''], ['ello', '24px'], ['wor', '24px'], ['ld', '']]);
});

test('normalization does not flatten relative font sizes or nested layout styles', () => {
  const root = fixture('<span style="font-size:2em"><span style="font-size:2em">large</span></span><span style="padding:4px"><span style="color:red">padded</span></span>');
  normalizeInline(root);
  assert.equal(root.querySelectorAll('span span').length, 2);
  const adjacent = fixture('<span style="padding:4px">a</span><span style="padding:4px">b</span>');
  normalizeInline(adjacent);
  assert.equal(adjacent.children.length, 2);
});

function tableFixture() {
  return fixture('<table><tbody><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>D</td><td>E</td><td>F</td></tr><tr><td>G</td><td>H</td><td>I</td></tr></tbody></table>').firstChild;
}
function rectangular(table, height, width) {
  const result = tableGrid(table);
  assert.equal(result.rows.length, height);
  assert.equal(result.width, width);
  for (const row of result.grid) {
    assert.equal(row.length, width);
    for (let c = 0; c < width; c++) assert.ok(row[c], `missing cell at column ${c}`);
  }
}

test('repeated merge down uses the next logical row; split restores every covered cell', () => {
  const table = tableFixture();
  const a = table.rows[0].cells[0];
  editTable(table, a, 'merge-down');
  editTable(table, a, 'merge-down');
  assert.equal(a.textContent, 'ADG');
  assert.equal(table.rows[1].cells[0].textContent, 'E');
  rectangular(table, 3, 3);
  editTable(table, a, 'split');
  rectangular(table, 3, 3);
  assert.equal(a.rowSpan, 1);
});

test('two-dimensional merged cells split into the full rectangle', () => {
  const table = tableFixture();
  const a = table.rows[0].cells[0];
  const d = table.rows[1].cells[0];
  editTable(table, a, 'merge-right');
  editTable(table, d, 'merge-right');
  editTable(table, a, 'merge-down');
  rectangular(table, 3, 3);
  editTable(table, a, 'split');
  rectangular(table, 3, 3);
  assert.equal(table.querySelectorAll('td').length, 9);
});

test('incompatible merged neighbors are rejected without altering the table', () => {
  const table = tableFixture();
  const a = table.rows[0].cells[0];
  editTable(table, a, 'merge-down');
  const before = table.outerHTML;
  assert.throws(() => editTable(table, a, 'merge-right'), /matching spans/);
  assert.equal(table.outerHTML, before);
});

test('inserting and deleting rows through rowspans preserves a rectangular grid', () => {
  const table = tableFixture();
  const a = table.rows[0].cells[0];
  editTable(table, a, 'merge-down');
  editTable(table, table.rows[1].cells[0], 'row-above');
  assert.equal(a.rowSpan, 3);
  rectangular(table, 4, 3);
  editTable(table, table.rows[1].cells[0], 'delete-row');
  assert.equal(a.rowSpan, 2);
  rectangular(table, 3, 3);
  editTable(table, a, 'delete-row');
  assert.equal(table.rows[0].cells[0].textContent, 'AD');
  rectangular(table, 2, 3);
});

test('inserting and deleting columns through colspans preserves other columns', () => {
  const table = tableFixture();
  const a = table.rows[0].cells[0];
  editTable(table, a, 'merge-right');
  editTable(table, table.rows[1].cells[1], 'col-left');
  assert.equal(a.colSpan, 3);
  rectangular(table, 3, 4);
  editTable(table, table.rows[1].cells[1], 'delete-col');
  assert.equal(a.colSpan, 2);
  rectangular(table, 3, 3);
});

test('rowspan zero respects row groups and merge cannot cross groups', () => {
  const table = fixture('<table><thead><tr><th>heading</th></tr></thead><tbody><tr><td rowspan="0">A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table>').firstChild;
  const result = tableGrid(table);
  assert.equal(result.cells.get(table.rows[1].cells[0]).height, 2);
  assert.throws(() => editTable(table, table.rows[0].cells[0], 'merge-down'), /same row group/);
});

test('inserting after a rowspan-zero cell does not implicitly overlap the new row', () => {
  const table = fixture('<table><tbody><tr><td rowspan="0">A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table>').firstChild;
  editTable(table, table.rows[0].cells[0], 'row-below');
  rectangular(table, 3, 2);
});
