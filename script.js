import { editTable, markRange, rangeBetween, splitInlineRange, styleRange, tableGrid, unwrap } from './editor-core.js';

const STORAGE_KEY = 'html5-editor-content';
const byId = (id) => document.getElementById(id);
const source = byId('html-source');
const frame = byId('editor-frame');
// No allow-scripts: authored styles and event handlers cannot affect the app.
const editorDocument = frame.contentDocument;
editorDocument.open();
editorDocument.write(`<!doctype html><html><head><meta charset="utf-8"><style>
  :root { color-scheme: light; }
  body { margin: 0; background: white; color: #1f2937; font: 16px Arial, sans-serif; }
  #editor { min-height: 100vh; box-sizing: border-box; padding: 1rem; outline: none; line-height: 1.55; overflow-wrap: anywhere; }
  #editor img { max-width: 100%; }
  [data-editor-selected] { outline: 2px solid #0d9488 !important; outline-offset: -2px; }
</style></head><body><div id="editor" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" aria-label="Rich text editor"></div></body></html>`);
editorDocument.close();
const editor = editorDocument.getElementById('editor');
const editorWindow = frame.contentWindow;
const defaultMarkup = '<h1>Start editing</h1>\n<p>Use the toolbar to style this text: headings, bold, lists, colors, links, and more.</p>';

let surface = 'live';
let savedRange = null;
let selectedImage = null;
let selectedCell = null;
let sourceSelection = [0, 0];
let saveTimer;
let sizeTimer;
let mutating = false;
let history = [];
let historyIndex = -1;

function status(message, saved = false) {
  byId('save-status').textContent = message;
  byId('save-status').classList.toggle('saved', saved);
}

function serialize() {
  const copy = editor.cloneNode(true);
  copy.querySelectorAll('[data-editor-selected], .is-selected-image, .is-selected-table-cell, [data-typo-span]').forEach((node) => {
    node.removeAttribute('data-editor-selected');
    node.removeAttribute('data-typo-span');
    node.classList.remove('is-selected-image', 'is-selected-table-cell');
    if (!node.getAttribute('class')) node.removeAttribute('class');
  });
  return copy.innerHTML;
}

function clearSelectionTargets() {
  editor.querySelectorAll('[data-editor-selected]').forEach((node) => node.removeAttribute('data-editor-selected'));
  selectedImage = null;
  selectedCell = null;
  syncInspectorState();
}

function syncInspectorState() {
  byId('image-controls').disabled = !selectedImage;
  byId('image-selection-hint').textContent = selectedImage
    ? 'Image selected. Size fields accept px, %, rem, auto, and other CSS values.'
    : 'Select an image in Live View to edit its properties.';
  byId('table-selection-hint').textContent = selectedCell
    ? 'Table selected. Cell fill applies to the selected cell; border and spacing apply to the table.'
    : 'Insert a table, or select a cell in Live View to edit it.';
  document.querySelectorAll('.table-tools button, .table-tools input, .table-tools select').forEach((control) => {
    if (!['add-table', 'table-rows', 'table-cols'].includes(control.id)) control.disabled = !selectedCell;
  });
}

function loadSource() {
  clearSelectionTargets();
  savedRange = null;
  editor.innerHTML = source.value;
  // Old saved documents may contain the former selection classes.
  editor.querySelectorAll('.is-selected-image, .is-selected-table-cell').forEach((node) => {
    node.classList.remove('is-selected-image', 'is-selected-table-cell');
    if (!node.getAttribute('class')) node.removeAttribute('class');
  });
}

function persist() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, source.value);
    status('Saved locally', true);
  } catch {
    status('Could not save locally. Copy HTML to keep your work.');
  }
}

function queuePersist() {
  clearTimeout(saveTimer);
  status('Saving...');
  saveTimer = setTimeout(persist, 280);
}

function nodePath(node) {
  if (!node || !editor.contains(node)) return null;
  const path = [];
  while (node && node !== editor) {
    path.unshift([...node.parentNode.childNodes].indexOf(node));
    node = node.parentNode;
  }
  return node === editor ? path : null;
}

function fromPath(path) {
  return path?.reduce((node, index) => node?.childNodes[index], editor);
}

function rangeBookmark() {
  if (!savedRange || !editor.contains(savedRange.commonAncestorContainer)) return null;
  return {
    start: nodePath(savedRange.startContainer), startOffset: savedRange.startOffset,
    end: nodePath(savedRange.endContainer), endOffset: savedRange.endOffset,
  };
}

function snapshot() {
  return { html: source.value, surface, selection: [...sourceSelection], range: rangeBookmark(), image: nodePath(selectedImage), cell: nodePath(selectedCell) };
}

function rememberSelection() {
  if (history[historyIndex]?.html === source.value) history[historyIndex] = snapshot();
}

function record() {
  if (history[historyIndex]?.html === source.value) return;
  history.splice(historyIndex + 1);
  history.push(snapshot());
  if (history.length > 200) history.shift();
  historyIndex = history.length - 1;
  refreshHistoryButtons();
}

function refreshHistoryButtons() {
  document.querySelector('[data-cmd="undo"]').disabled = historyIndex <= 0;
  document.querySelector('[data-cmd="redo"]').disabled = historyIndex >= history.length - 1;
}

function setRange(range, focus = true) {
  savedRange = range.cloneRange();
  if (focus) editor.focus();
  const selection = editorWindow.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function restoreBookmark(bookmark) {
  if (!bookmark) return;
  const start = fromPath(bookmark.start);
  const end = fromPath(bookmark.end);
  if (!start || !end) return;
  const length = (node) => node.nodeType === 3 ? node.length : node.childNodes.length;
  const range = editorDocument.createRange();
  range.setStart(start, Math.min(bookmark.startOffset, length(start)));
  range.setEnd(end, Math.min(bookmark.endOffset, length(end)));
  setRange(range, false);
}

function moveHistory(direction) {
  clearTimeout(sizeTimer);
  const next = historyIndex + direction;
  if (next < 0 || next >= history.length) return;
  rememberSelection();
  mutating = true;
  try {
    historyIndex = next;
    const entry = history[next];
    source.value = entry.html;
    loadSource();
    surface = entry.surface;
    sourceSelection = [...entry.selection];
    restoreBookmark(entry.range);
    setTargets(fromPath(entry.image), fromPath(entry.cell));
    if (surface === 'source') {
      source.focus();
      source.setSelectionRange(...sourceSelection);
    } else editor.focus();
    refreshControls();
    refreshHistoryButtons();
    queuePersist();
  } finally {
    mutating = false;
  }
}

function getRange(focus = true) {
  if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
    if (focus) setRange(savedRange);
    return savedRange.cloneRange();
  }
  const range = editorDocument.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  if (focus) setRange(range);
  return range;
}

function saveLiveSelection() {
  const selection = editorWindow.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  savedRange = range.cloneRange();
}

function syncSourceSelection() {
  sourceSelection = [source.selectionStart, source.selectionEnd];
  rememberSelection();
}

function change(operation, { sourceEdit = false } = {}) {
  if (mutating) return false;
  rememberSelection();
  const before = snapshot();
  mutating = true;
  try {
    if (operation() === false) return false;
    if (!sourceEdit) source.value = serialize();
    record();
    queuePersist();
    return true;
  } catch (error) {
    source.value = before.html;
    loadSource();
    surface = before.surface;
    sourceSelection = before.selection;
    restoreBookmark(before.range);
    setTargets(fromPath(before.image), fromPath(before.cell));
    status(error.message || 'Could not apply edit');
    return false;
  } finally {
    mutating = false;
    refreshHistoryButtons();
  }
}

function selectedElement() {
  const node = savedRange?.startContainer;
  return node?.nodeType === 1 ? node : node?.parentElement;
}

function setTargets(image, cell) {
  const imageChanged = selectedImage !== image;
  const cellChanged = selectedCell !== cell;
  clearSelectionTargets();
  if (image?.tagName === 'IMG' && editor.contains(image)) selectedImage = image;
  if (cell?.matches('td, th') && editor.contains(cell)) selectedCell = cell;
  (selectedImage || selectedCell)?.setAttribute('data-editor-selected', '');
  syncInspectorState();
  if (selectedImage && imageChanged) {
    document.querySelector('.table-section').open = false;
    document.querySelector('.image-section').open = true;
  } else if (selectedCell && cellChanged) {
    document.querySelector('.image-section').open = false;
    document.querySelector('.table-section').open = true;
  }
}

function selectFromRange() {
  const element = selectedElement();
  const cell = element?.closest('td, th');
  // Clicking an inline image may leave the native caret beside it rather than
  // selecting its node. Keep that explicit target until the user moves away.
  if (selectedImage && editor.contains(selectedImage) && (savedRange?.collapsed || savedRange?.intersectsNode(selectedImage))) return;
  setTargets(null, cell);
}

// Map source offsets through comment bookmarks, so edits use the same DOM engine.
// A selection inside a tag/attribute cannot be mapped and is rejected explicitly.
function editSourceRange(operation) {
  const original = source.value;
  const [start, end] = sourceSelection;
  if (start === end) {
    status('Select text or HTML to format');
    return false;
  }
  const token = `editor-${crypto.randomUUID()}`;
  const startTag = `<!--${token}-start-->`;
  const endTag = `<!--${token}-end-->`;
  editor.innerHTML = original.slice(0, start) + startTag + original.slice(start, end) + endTag + original.slice(end);
  const walker = editorDocument.createTreeWalker(editor, 128);
  let first;
  let last;
  while (walker.nextNode()) {
    if (walker.currentNode.data === `${token}-start`) first = walker.currentNode;
    if (walker.currentNode.data === `${token}-end`) last = walker.currentNode;
  }
  if (!first || !last || !(first.compareDocumentPosition(last) & 4)) {
    loadSource();
    status('Select complete HTML or text, not part of a tag or attribute');
    return false;
  }
  let range = rangeBetween(first, last);
  first.remove();
  last.remove();
  range = operation(range) || range;
  const markers = markRange(range);
  markers.start.data = `${token}-start`;
  markers.end.data = `${token}-end`;
  const marked = serialize();
  const newStart = marked.indexOf(startTag);
  const newEnd = marked.indexOf(endTag) - startTag.length;
  markers.start.remove();
  markers.end.remove();
  source.value = marked.replace(startTag, '').replace(endTag, '');
  sourceSelection = [newStart, newEnd];
  savedRange = null;
  clearSelectionTargets();
  source.setSelectionRange(...sourceSelection);
  return true;
}

function applyStyle(property, value) {
  clearTimeout(sizeTimer);
  const isSource = surface === 'source';
  change(() => {
    if (isSource) return editSourceRange((range) => styleRange(editor, range, property, value));
    const range = getRange(false);
    if (range.collapsed) {
      status('Select text to change its style');
      return false;
    }
    const updated = styleRange(editor, range, property, value);
    if (updated) {
      savedRange = updated.cloneRange();
      // Keep number inputs and native color pickers focused during live updates.
      if (document.activeElement === frame) setRange(updated, false);
    }
  }, { sourceEdit: isSource });
}

function sourceCommand(command, value) {
  const styles = { bold: ['font-weight', 'bold'], italic: ['font-style', 'italic'], underline: ['text-decoration', 'underline'], strikeThrough: ['text-decoration', 'line-through'] };
  if (styles[command]) return editSourceRange((range) => styleRange(editor, range, ...styles[command]));
  return editSourceRange((range) => {
    const markers = splitInlineRange(editor, range);
    const selected = rangeBetween(markers.start, markers.end);
    const intersects = (node) => selected.intersectsNode(node);
    const blocks = [...editor.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, pre, li, div')].filter(intersects).filter((node) => ![...node.children].some((child) => child.matches('p, h1, h2, h3, h4, h5, h6, blockquote, pre, li, div') && intersects(child)));
    if (command === 'unlink') {
      // Split link boundaries without removing other inline formatting.
      const fragment = selected.extractContents();
      fragment.querySelectorAll('a').forEach(unwrap);
      markers.start.after(fragment);
    } else if (command === 'removeFormat') {
      const fragment = selected.extractContents();
      fragment.querySelectorAll('*').forEach((node) => node.removeAttribute('style'));
      fragment.querySelectorAll('span, font, b, strong, i, em, u, s, strike').forEach(unwrap);
      markers.start.after(fragment);
    } else if (command === 'formatBlock') {
      const tag = String(value).toLowerCase();
      if (!['p', 'h1', 'h2', 'h3', 'blockquote', 'pre'].includes(tag)) throw new Error('Unsupported block type');
      if (blocks.length) blocks.forEach((block) => {
        const replacement = editorDocument.createElement(tag);
        for (const { name, value: attr } of [...block.attributes]) replacement.setAttribute(name, attr);
        replacement.append(...block.childNodes);
        block.replaceWith(replacement);
      });
      else {
        const block = editorDocument.createElement(tag);
        block.append(selected.extractContents());
        markers.start.after(block);
      }
    } else if (command.startsWith('justify')) {
      const align = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right' }[command];
      if (blocks.length) blocks.forEach((block) => { block.style.textAlign = align; });
      else {
        const block = editorDocument.createElement('div');
        block.style.textAlign = align;
        block.append(selected.extractContents());
        markers.start.after(block);
      }
    } else if (command === 'insertUnorderedList' || command === 'insertOrderedList') {
      const list = editorDocument.createElement(command === 'insertOrderedList' ? 'ol' : 'ul');
      const item = editorDocument.createElement('li');
      item.append(selected.extractContents());
      list.append(item);
      markers.start.after(list);
    } else throw new Error('This command is not available for the source selection');
    const result = rangeBetween(markers.start, markers.end);
    markers.start.remove();
    markers.end.remove();
    return result;
  });
}

function runCommand(command, value = null) {
  clearTimeout(sizeTimer);
  if (command === 'undo' || command === 'redo') return moveHistory(command === 'undo' ? -1 : 1);
  const isSource = surface === 'source';
  change(() => {
    if (isSource) return sourceCommand(command, value);
    getRange();
    editorDocument.execCommand('styleWithCSS', false, true);
    editorDocument.execCommand(command, false, value);
    saveLiveSelection();
  }, { sourceEdit: isSource });
  refreshControls();
}

function insertHTML(markup) {
  const isSource = surface === 'source';
  change(() => {
    if (isSource) {
      const [start, end] = sourceSelection;
      source.setRangeText(markup, start, end, 'end');
      sourceSelection = [start + markup.length, start + markup.length];
      loadSource();
      source.focus();
    } else {
      getRange();
      editorDocument.execCommand('insertHTML', false, markup);
      saveLiveSelection();
    }
  }, { sourceEdit: isSource });
}

function hex(color) {
  const match = String(color).match(/^rgba?\((\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:[, /]+\s*([\d.]+))?\)$/);
  if (!match || (match[4] !== undefined && Number(match[4]) === 0)) return null;
  return '#' + match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('');
}

function setColor(id, color) {
  const value = hex(color);
  if (value) byId(id).value = value;
}

function refreshControls() {
  if (surface === 'source') return;
  const element = selectedElement();
  if (element && editor.contains(element)) {
    const computed = editorWindow.getComputedStyle(element);
    const normalizeFont = (font) => font.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    const option = [...byId('font-family').options].find((item) => normalizeFont(item.value) === normalizeFont(computed.fontFamily));
    byId('font-family').value = option?.value || '';
    byId('font-size').value = ({ 12: '2', 16: '3', 18: '4', 24: '5', 32: '6' })[parseFloat(computed.fontSize)] || '';
    let sized = element;
    while (sized !== editor && !sized.style.fontSize) sized = sized.parentElement;
    const size = (sized.style.fontSize || computed.fontSize).match(/^([\d.]+)(px|rem|em|%|pt)$/);
    if (size && document.activeElement !== byId('custom-size-value') && document.activeElement !== byId('custom-size-unit')) {
      byId('custom-size-value').value = size[1];
      byId('custom-size-unit').value = size[2];
    }
    setColor('text-color', computed.color);
    setColor('bg-color', computed.backgroundColor);
    const block = element.closest('p, h1, h2, h3, blockquote, pre');
    byId('block-type').value = block?.tagName || 'P';
  }
  document.querySelectorAll('[data-cmd]').forEach((button) => {
    try { button.classList.toggle('is-active', editorDocument.queryCommandState(button.dataset.cmd)); } catch { /* Unsupported command. */ }
  });
  if (selectedImage) syncImageControls();
  if (selectedCell) syncTableControls();
}

function applyCustomSize() {
  clearTimeout(sizeTimer);
  const value = Number(byId('custom-size-value').value);
  const unit = byId('custom-size-unit').value;
  if (!Number.isFinite(value) || value <= 0 || !['px', 'rem', 'em', '%', 'pt'].includes(unit)) return status('Enter a valid size value');
  applyStyle('font-size', `${value}${unit}`);
}

function requireImage() {
  if (!selectedImage || !editor.contains(selectedImage)) throw new Error('Select an image first');
  return selectedImage;
}

const imageCssFields = {
  'image-width-value': 'width',
  'image-height': 'height',
  'image-min-width': 'min-width',
  'image-max-width': 'max-width',
  'image-min-height': 'min-height',
  'image-max-height': 'max-height',
  'image-margin': 'margin',
  'image-float': 'float',
  'image-vertical-align': 'vertical-align',
  'image-object-position': 'object-position',
  'image-border-width': 'border-width',
  'image-border-style': 'border-style',
  'image-border-color': 'border-color',
};
const imageAttributeFields = { 'image-alt': 'alt', 'image-title': 'title', 'image-loading': 'loading' };

function syncImageControls() {
  const image = selectedImage;
  for (const [id, property] of Object.entries(imageCssFields)) {
    const input = byId(id);
    input.value = image.style.getPropertyValue(property);
    input.setCustomValidity('');
    input.dataset.dirty = 'false';
    // Keep authored width/height attributes visible without converting them to CSS.
    if (!input.value && (property === 'width' || property === 'height')) {
      const attribute = image.getAttribute(property);
      if (attribute && /^\d+$/.test(attribute)) input.value = `${attribute}px`;
    }
  }
  for (const [id, attribute] of Object.entries(imageAttributeFields)) {
    byId(id).value = image.getAttribute(attribute) || '';
    byId(id).dataset.dirty = 'false';
  }
  byId('image-display').value = image.style.display;
  byId('image-padding').value = parseFloat(image.style.padding) || 0;
  byId('image-radius').value = parseFloat(image.style.borderRadius) || 0;
  byId('image-fit').value = image.style.objectFit;
  syncImageAlignment(image);
}

function applyImageCss(id, property) {
  const input = byId(id);
  let value = input.value.trim();
  if (['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'margin', 'border-width', 'vertical-align'].includes(property) && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) value += 'px';
  if (value && !editorWindow.CSS.supports(property, value)) {
    input.setCustomValidity(`Enter a valid CSS ${property} value`);
    status(`Invalid image ${property}: ${value}`);
    return;
  }
  input.setCustomValidity('');
  change(() => {
    const image = requireImage();
    if (value) image.style.setProperty(property, value);
    else image.style.removeProperty(property);
    input.value = image.style.getPropertyValue(property);
    input.dataset.dirty = 'false';
    if (property === 'margin') syncImageAlignment(image);
  });
}

function syncImageAlignment(image) {
  byId('image-align').value = image.style.marginLeft === 'auto' ? (image.style.marginRight === 'auto' ? 'center' : 'right') : 'left';
}

function imageStyle(field) {
  change(() => {
    const image = requireImage();
    if (field === 'padding') image.style.padding = `${Math.max(0, Number(byId('image-padding').value) || 0)}px`;
    else if (field === 'radius') image.style.borderRadius = `${Math.max(0, Number(byId('image-radius').value) || 0)}px`;
    else if (field === 'fit') image.style.objectFit = byId('image-fit').value;
    else if (field === 'display') image.style.display = byId('image-display').value;
    else if (field === 'align') {
      // Automatic margins only align block images.
      image.style.display = 'block';
      image.style.cssFloat = 'none';
      byId('image-float').value = 'none';
      byId('image-display').value = 'block';
      image.style.marginLeft = byId('image-align').value === 'left' ? '0' : 'auto';
      image.style.marginRight = byId('image-align').value === 'right' ? '0' : 'auto';
      byId('image-margin').value = image.style.margin;
    }
  });
}

function getTable() {
  if (!selectedCell || !editor.contains(selectedCell)) throw new Error('Select a table cell first');
  return selectedCell.closest('table');
}

function syncTableControls() {
  const table = selectedCell.closest('table');
  const computed = editorWindow.getComputedStyle(selectedCell);
  byId('table-rows').value = table.rows.length;
  try {
    byId('table-cols').value = tableGrid(table).width;
  } catch (error) {
    status(error.message);
    return;
  }
  setColor('table-bg', table.style.backgroundColor);
  setColor('table-cell-bg', selectedCell.style.backgroundColor);
  setColor('table-border-color', computed.borderTopColor);
  byId('table-border-width').value = parseFloat(computed.borderTopWidth) || 0;
  byId('table-cell-padding').value = parseFloat(computed.paddingTop) || 0;
  byId('table-zebra-mode').value = table.dataset.zebra === 'on' ? 'on' : 'off';
  if (table.dataset.zebraA) byId('table-zebra-a').value = table.dataset.zebraA;
  if (table.dataset.zebraB) byId('table-zebra-b').value = table.dataset.zebraB;
}

function stripeTable(table) {
  if (table.dataset.zebra !== 'on') return;
  [...table.rows].forEach((row, index) => {
    row.style.backgroundColor = index % 2 ? table.dataset.zebraB : table.dataset.zebraA;
  });
}

function tableStyle(field) {
  change(() => {
    const table = getTable();
    if (field === 'background') table.style.backgroundColor = byId('table-bg').value;
    if (field === 'border' || field === 'all') {
      table.style.borderCollapse = 'collapse';
      [...table.rows].forEach((row) => [...row.cells].forEach((cell) => {
        cell.style.border = `${Math.max(0, Number(byId('table-border-width').value) || 0)}px solid ${byId('table-border-color').value}`;
      }));
    }
    if (field === 'padding' || field === 'all') {
      [...table.rows].forEach((row) => [...row.cells].forEach((cell) => {
        cell.style.padding = `${Math.max(0, Number(byId('table-cell-padding').value) || 0)}px`;
      }));
    }
    if (field === 'zebra' || field === 'all') {
      const wasStriped = table.dataset.zebra === 'on';
      table.dataset.zebra = byId('table-zebra-mode').value;
      table.dataset.zebraA = byId('table-zebra-a').value;
      table.dataset.zebraB = byId('table-zebra-b').value;
      if (wasStriped && table.dataset.zebra !== 'on') [...table.rows].forEach((row) => { row.style.backgroundColor = ''; });
      stripeTable(table);
    }
  });
}

const on = (id, event, handler) => byId(id).addEventListener(event, handler);
document.querySelectorAll('.toolbar button').forEach((button) => button.addEventListener('mousedown', (event) => event.preventDefault()));
document.querySelectorAll('[data-cmd]').forEach((button) => button.addEventListener('click', () => runCommand(button.dataset.cmd)));
on('block-type', 'change', () => runCommand('formatBlock', byId('block-type').value));
on('font-family', 'change', () => applyStyle('font-family', byId('font-family').value || null));
on('font-size', 'change', () => applyStyle('font-size', ({ 2: '12px', 3: '16px', 4: '18px', 5: '24px', 6: '32px' })[byId('font-size').value] || null));
on('apply-custom-size', 'click', () => applyCustomSize());
on('custom-size-value', 'input', () => {
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(applyCustomSize, 420);
});
on('custom-size-value', 'change', applyCustomSize);
on('custom-size-unit', 'change', applyCustomSize);
on('text-color', 'input', () => applyStyle('color', byId('text-color').value));
on('bg-color', 'input', () => applyStyle('background-color', byId('bg-color').value));
on('text-color-none', 'click', () => applyStyle('color', null));
on('bg-color-none', 'click', () => applyStyle('background-color', null));

on('add-link', 'click', insertLink);
on('remove-link', 'click', () => runCommand('unlink'));
function insertLink() {
  const url = prompt('Enter link URL', 'https://');
  if (!url?.trim()) return;
  if (surface === 'source') {
    change(() => editSourceRange((range) => {
      const markers = splitInlineRange(editor, range);
      range = rangeBetween(markers.start, markers.end);
      const link = editorDocument.createElement('a');
      link.href = url.trim();
      link.append(range.extractContents());
      link.querySelectorAll('a').forEach(unwrap);
      range.insertNode(link);
      range.selectNode(link);
      markers.start.remove();
      markers.end.remove();
      return range;
    }), { sourceEdit: true });
  } else runCommand('createLink', url.trim());
}
on('add-image', 'click', () => {
  const url = prompt('Enter image URL', 'https://');
  if (!url?.trim()) return;
  const image = editorDocument.createElement('img');
  image.setAttribute('src', url.trim());
  image.alt = '';
  image.style.maxWidth = '100%';
  image.style.height = 'auto';
  insertHTML(image.outerHTML);
});

for (const [id, event, field] of [
  ['image-display', 'change', 'display'], ['image-align', 'change', 'align'],
  ['image-padding', 'input', 'padding'], ['image-radius', 'input', 'radius'], ['image-fit', 'change', 'fit'],
]) on(id, event, () => imageStyle(field));
for (const [id, property] of Object.entries(imageCssFields)) {
  on(id, 'input', () => {
    byId(id).setCustomValidity('');
    byId(id).dataset.dirty = 'true';
  });
  on(id, 'change', () => {
    if (byId(id).dataset.dirty === 'true' && !mutating) applyImageCss(id, property);
  });
  on(id, 'keydown', (event) => {
    if (event.key === 'Enter' && byId(id).tagName === 'INPUT') {
      event.preventDefault();
      applyImageCss(id, property);
    }
  });
}
for (const [id, attribute] of Object.entries(imageAttributeFields)) {
  const apply = () => change(() => {
    const image = requireImage();
    const value = byId(id).value;
    if (value || attribute === 'alt') image.setAttribute(attribute, value);
    else image.removeAttribute(attribute);
    byId(id).dataset.dirty = 'false';
  });
  on(id, 'input', () => { byId(id).dataset.dirty = 'true'; });
  on(id, 'change', () => {
    if (byId(id).dataset.dirty === 'true') apply();
  });
  on(id, 'keydown', (event) => {
    if (event.key === 'Enter' && byId(id).tagName === 'INPUT') {
      event.preventDefault();
      apply();
    }
  });
}
on('reset-image-style', 'click', () => change(() => {
  const image = requireImage();
  image.removeAttribute('style');
  image.style.maxWidth = '100%';
  image.style.height = 'auto';
  syncImageControls();
}));
on('wrap-image', 'click', () => change(() => {
  const image = requireImage();
  if (image.parentElement.classList.contains('image-frame')) unwrap(image.parentElement);
  else {
    // A span is valid inside paragraphs; frame styles travel with copied HTML.
    const wrapper = editorDocument.createElement('span');
    wrapper.className = 'image-frame';
    wrapper.style.cssText = 'display:inline-block;max-width:100%;box-sizing:border-box;margin:0.75rem 0;padding:12px;border:1px dashed #94a3b8;border-radius:14px;';
    image.replaceWith(wrapper);
    wrapper.append(image);
  }
}));

on('add-table', 'click', () => {
  const rows = Math.min(20, Math.max(1, Math.floor(Number(byId('table-rows').value) || 3)));
  const cols = Math.min(12, Math.max(1, Math.floor(Number(byId('table-cols').value) || 3)));
  insertHTML(`<table style="border-collapse:collapse;width:100%"><tbody>${Array.from({ length: rows }, (_, r) => `<tr>${Array.from({ length: cols }, (_, c) => `<td style="border:1px solid #6b7280;padding:8px">Cell ${r + 1}-${c + 1}</td>`).join('')}</tr>`).join('')}</tbody></table><p><br></p>`);
});
for (const [id, action] of [
  ['table-add-row-above', 'row-above'], ['table-add-row-below', 'row-below'],
  ['table-add-col-left', 'col-left'], ['table-add-col-right', 'col-right'],
  ['table-delete-row', 'delete-row'], ['table-delete-col', 'delete-col'],
  ['table-merge-right', 'merge-right'], ['table-merge-down', 'merge-down'], ['table-split-cell', 'split'],
]) on(id, 'click', () => change(() => {
  const table = getTable();
  const cell = editTable(table, selectedCell, action);
  stripeTable(table);
  setTargets(null, cell);
  const range = editorDocument.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  setRange(range, false);
  syncTableControls();
}));
on('table-delete', 'click', () => change(() => { getTable().remove(); clearSelectionTargets(); savedRange = null; }));
on('table-cell-bg', 'input', () => change(() => { getTable(); selectedCell.style.backgroundColor = byId('table-cell-bg').value; }));
on('table-cell-bg-none', 'click', () => change(() => { getTable(); selectedCell.style.backgroundColor = ''; }));
on('table-bg', 'input', () => tableStyle('background'));
on('table-bg-none', 'click', () => change(() => { getTable().style.backgroundColor = ''; }));
on('table-border-color', 'input', () => tableStyle('border'));
on('table-border-width', 'input', () => tableStyle('border'));
on('table-cell-padding', 'input', () => tableStyle('padding'));
on('table-zebra-mode', 'change', () => tableStyle('zebra'));
on('table-zebra-a', 'input', () => tableStyle('zebra'));
on('table-zebra-b', 'input', () => tableStyle('zebra'));
on('table-apply-style', 'click', () => tableStyle('all'));

on('clear-editor', 'click', () => change(() => {
  clearTimeout(sizeTimer);
  editor.replaceChildren();
  clearSelectionTargets();
  savedRange = null;
  surface = 'live';
  getRange();
}));
on('copy-html', 'click', async () => {
  try {
    await navigator.clipboard.writeText(source.value);
    status('HTML copied', true);
  } catch { status('Clipboard unavailable. Select and copy the HTML source.'); }
});
on('wrap-toggle', 'change', () => {
  source.classList.toggle('no-wrap', !byId('wrap-toggle').checked);
  source.wrap = byId('wrap-toggle').checked ? 'soft' : 'off';
});

source.addEventListener('focus', () => { clearTimeout(sizeTimer); surface = 'source'; syncSourceSelection(); });
for (const event of ['click', 'keyup', 'select', 'blur']) source.addEventListener(event, syncSourceSelection);
source.addEventListener('input', () => {
  if (mutating) return;
  clearTimeout(sizeTimer);
  surface = 'source';
  sourceSelection = [source.selectionStart, source.selectionEnd];
  loadSource();
  record();
  queuePersist();
});
editor.addEventListener('focus', () => { surface = 'live'; });
editor.addEventListener('pointerdown', () => {
  clearTimeout(sizeTimer);
  clearSelectionTargets();
});
editor.addEventListener('keydown', (event) => {
  clearTimeout(sizeTimer);
  if (!event.ctrlKey && !event.metaKey) clearSelectionTargets();
});
editor.addEventListener('input', () => {
  if (mutating) return;
  saveLiveSelection();
  source.value = serialize();
  record();
  queuePersist();
});
editorDocument.addEventListener('selectionchange', () => {
  if (mutating || document.activeElement !== frame || surface !== 'live') return;
  saveLiveSelection();
  selectFromRange();
  rememberSelection();
  refreshControls();
});
editor.addEventListener('click', (event) => {
  // Keep authored links from navigating the editing frame away from its document.
  if (event.target.closest('a')) event.preventDefault();
  saveLiveSelection();
  setTargets(event.target.closest('img'), event.target.closest('td, th'));
  rememberSelection();
  refreshControls();
});
editor.addEventListener('submit', (event) => event.preventDefault());

function beforeInput(event) {
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault();
    moveHistory(event.inputType === 'historyUndo' ? -1 : 1);
  } else rememberSelection();
}
editor.addEventListener('beforeinput', beforeInput);
source.addEventListener('beforeinput', beforeInput);
function keyboard(event) {
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === 's') { event.preventDefault(); persist(); return; }
  if (event.currentTarget === document && event.target !== source) return;
  const command = ({ b: 'bold', i: 'italic', u: 'underline' })[key];
  if (key === 'z' || key === 'y') {
    event.preventDefault();
    moveHistory(key === 'y' || event.shiftKey ? 1 : -1);
  } else if (command) {
    event.preventDefault();
    runCommand(command);
  } else if (key === 'k') {
    event.preventDefault();
    insertLink();
  } else if (event.shiftKey && (event.code === 'Digit7' || event.code === 'Digit8')) {
    event.preventDefault();
    runCommand(event.code === 'Digit7' ? 'insertOrderedList' : 'insertUnorderedList');
  }
}
document.addEventListener('keydown', keyboard);
editorDocument.addEventListener('keydown', keyboard);
window.addEventListener('pagehide', persist);

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  source.value = saved === null ? defaultMarkup : saved;
  status(saved === null ? 'Ready' : 'Loaded from local storage', true);
} catch {
  source.value = defaultMarkup;
  status('Local storage unavailable. Copy HTML to keep your work.');
}
loadSource();
// Strip only old editor metadata on load; keep authored whitespace and CSS intact.
source.value = serialize();
source.wrap = 'soft';
record();
refreshHistoryButtons();

function initializeWorkspace() {
  const workspace = byId('workspace');
  const divider = byId('pane-divider');
  const heightHandle = byId('workspace-resize');
  const stacked = window.matchMedia('(max-width: 980px)');
  const shortcuts = document.querySelector('.header-shortcuts');
  const toolbar = byId('formatting-tools');
  let sourceShare = 52;

  function setShare(value) {
    sourceShare = Math.max(20, Math.min(80, value));
    workspace.style.setProperty('--source-share', `${sourceShare}fr`);
    workspace.style.setProperty('--live-share', `${100 - sourceShare}fr`);
    divider.setAttribute('aria-valuenow', String(Math.round(sourceShare)));
    divider.setAttribute('aria-valuetext', `HTML Editor ${Math.round(sourceShare)}%, Live View ${Math.round(100 - sourceShare)}%`);
  }

  function setHeight(value) {
    workspace.style.setProperty('--workspace-height', `${Math.max(320, Math.min(1600, value))}px`);
  }

  function updateOrientation() {
    divider.setAttribute('aria-orientation', stacked.matches ? 'horizontal' : 'vertical');
    fitWorkspace();
  }
  function fitWorkspace() {
    const top = workspace.getBoundingClientRect().top + window.scrollY;
    const minimum = stacked.matches ? 480 : 360;
    workspace.style.setProperty('--workspace-default-height', `${Math.min(1600, Math.max(minimum, window.innerHeight - top - 28))}px`);
  }
  const chromeObserver = new ResizeObserver(fitWorkspace);
  chromeObserver.observe(document.querySelector('.app-header'));
  chromeObserver.observe(toolbar);
  window.addEventListener('resize', fitWorkspace);
  byId('focus-mode').addEventListener('click', () => {
    toolbar.hidden = !toolbar.hidden;
    byId('focus-mode').setAttribute('aria-pressed', String(toolbar.hidden));
    byId('focus-mode').textContent = toolbar.hidden ? 'Exit focus' : 'Focus';
    byId('focus-mode').title = toolbar.hidden ? 'Show formatting tools' : 'Hide formatting tools for more editing space';
    fitWorkspace();
  });
  stacked.addEventListener('change', updateOrientation);
  updateOrientation();
  setShare(sourceShare);
  new ResizeObserver(() => {
    const height = Math.round(workspace.getBoundingClientRect().height);
    heightHandle.setAttribute('aria-valuenow', String(Math.max(320, Math.min(1600, height))));
    heightHandle.setAttribute('aria-valuetext', `${height} pixels`);
  }).observe(workspace);

  for (const [name, title] of [['source', 'HTML Editor'], ['live', 'Live View']]) {
    const panel = byId(`${name}-panel`);
    const body = byId(`${name}-panel-body`);
    const button = byId(`toggle-${name}-panel`);
    button.addEventListener('click', () => {
      clearTimeout(sizeTimer);
      const collapsed = !body.hidden;
      body.hidden = collapsed;
      panel.classList.toggle('is-collapsed', collapsed);
      workspace.classList.toggle(`${name}-collapsed`, collapsed);
      button.textContent = collapsed ? 'Expand' : 'Collapse';
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${title}`);
      const sourceHidden = byId('source-panel-body').hidden;
      const liveHidden = byId('live-panel-body').hidden;
      divider.hidden = sourceHidden || liveHidden;
      heightHandle.hidden = sourceHidden && liveHidden;
      // Toolbar commands should target the editing surface that is still visible.
      if (sourceHidden && !liveHidden) surface = 'live';
      if (liveHidden && !sourceHidden) surface = 'source';
    });
  }

  function draggable(handle, start, move) {
    let pointer = null;
    let origin;
    const stop = () => {
      if (pointer === null) return;
      const previous = pointer;
      pointer = null;
      document.body.classList.remove('is-resizing');
      document.body.style.cursor = '';
      if (handle.hasPointerCapture(previous)) handle.releasePointerCapture(previous);
    };
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || pointer !== null) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      pointer = event.pointerId;
      origin = start(event);
      handle.setPointerCapture(pointer);
      document.body.classList.add('is-resizing');
      document.body.style.cursor = getComputedStyle(handle).cursor;
    });
    handle.addEventListener('pointermove', (event) => {
      if (event.pointerId === pointer) move(event, origin);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(event, stop);
    window.addEventListener('blur', stop);
  }

  draggable(divider, (event) => {
    const rect = divider.getBoundingClientRect();
    return stacked.matches ? event.clientY - rect.top : event.clientX - rect.left;
  }, (event, grabOffset) => {
    const rect = workspace.getBoundingClientRect();
    const length = stacked.matches ? rect.height : rect.width;
    const offset = stacked.matches ? event.clientY - rect.top : event.clientX - rect.left;
    setShare(100 * (offset - grabOffset) / Math.max(1, length - 10));
  });
  draggable(heightHandle, (event) => ({ y: event.clientY, height: workspace.getBoundingClientRect().height }),
    (event, origin) => setHeight(origin.height + event.clientY - origin.y));

  divider.addEventListener('keydown', (event) => {
    const decrease = stacked.matches ? 'ArrowUp' : 'ArrowLeft';
    const increase = stacked.matches ? 'ArrowDown' : 'ArrowRight';
    if (![decrease, increase, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    setShare(event.key === 'Home' ? 20 : event.key === 'End' ? 80 : sourceShare + (event.key === decrease ? -step : step));
  });
  heightHandle.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 100 : 20;
    setHeight(event.key === 'Home' ? 320 : event.key === 'End' ? 1600 : workspace.getBoundingClientRect().height + (event.key === 'ArrowUp' ? -step : step));
  });
  divider.addEventListener('dblclick', () => setShare(52));
  heightHandle.addEventListener('dblclick', () => workspace.style.removeProperty('--workspace-height'));

  document.addEventListener('pointerdown', (event) => {
    if (!shortcuts.contains(event.target)) shortcuts.open = false;
  });
  editorDocument.addEventListener('pointerdown', () => { shortcuts.open = false; });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shortcuts.open) {
      shortcuts.open = false;
      shortcuts.querySelector('summary').focus();
    }
  });
}

initializeWorkspace();
