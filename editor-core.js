// DOM transformations shared by the live editor and HTML-source commands.
const BLOCKS = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'UL']);

export function unwrap(node) {
  node.replaceWith(...node.childNodes);
}

function plainSpan(node) {
  return node?.nodeType === 1 && node.tagName === 'SPAN' &&
    [...node.attributes].every(({ name }) => name === 'style' || name === 'data-typo-span');
}

function styleKey(node) {
  return Array.from(node.style).sort().map((name) => [name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]).map(JSON.stringify).join('|');
}

const TYPOGRAPHY_PROPERTIES = new Set(['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'background-color']);

function canFlatten(parent, child) {
  // Relative sizes and layout properties are not equivalent after removing a
  // nesting level. Only combine disjoint, simple typography declarations.
  return [...Array.from(parent.style), ...Array.from(child.style)].every((name) => TYPOGRAPHY_PROPERTIES.has(name)) &&
    Array.from(child.style).every((name) => !parent.style.getPropertyValue(name));
}

export function normalizeInline(root) {
  // CSSOM parses declarations without reordering shorthand/longhand precedence,
  // breaking quoted semicolons, or changing case-sensitive custom properties.
  for (const span of [...root.querySelectorAll('span')].reverse()) {
    if (!plainSpan(span)) continue;
    span.removeAttribute('data-typo-span');
    if (span.hasAttribute('style')) span.style.cssText = span.style.cssText;
    if (!span.style.length) {
      unwrap(span);
      continue;
    }
    while (span.childNodes.length === 1 && plainSpan(span.firstChild) && canFlatten(span, span.firstChild)) {
      const child = span.firstChild;
      for (const name of Array.from(child.style)) {
        span.style.setProperty(name, child.style.getPropertyValue(name), child.style.getPropertyPriority(name));
      }
      unwrap(child);
    }
    // Whitespace is content: never jump over it to join two spans.
    while (plainSpan(span.nextSibling) && Array.from(span.style).every((name) => TYPOGRAPHY_PROPERTIES.has(name)) && styleKey(span) === styleKey(span.nextSibling)) {
      const next = span.nextSibling;
      span.append(...next.childNodes);
      next.remove();
    }
  }
}

function splitAtMarker(marker, root) {
  while (marker.parentNode !== root && !BLOCKS.has(marker.parentNode.tagName)) {
    const parent = marker.parentNode;
    const right = parent.cloneNode(false);
    // Splitting a link/span must not introduce duplicate element IDs.
    right.removeAttribute('id');
    while (marker.nextSibling) right.append(marker.nextSibling);
    parent.after(marker);
    const hasContent = (node) => [...node.childNodes].some((child) => child.nodeType !== 3 || child.data.length > 0);
    if (hasContent(right)) {
      if (!hasContent(parent) && parent.id) right.id = parent.id;
      marker.after(right);
    }
    if (!hasContent(parent)) parent.remove();
  }
}

export function markRange(range) {
  const doc = range.startContainer.ownerDocument;
  const start = doc.createComment('selection-start');
  const end = doc.createComment('selection-end');
  const endRange = range.cloneRange();
  endRange.collapse(false);
  endRange.insertNode(end);
  const startRange = range.cloneRange();
  startRange.collapse(true);
  startRange.insertNode(start);
  return { start, end };
}

export function rangeBetween(start, end) {
  const range = start.ownerDocument.createRange();
  range.setStartAfter(start);
  range.setEndBefore(end);
  return range;
}

export function splitInlineRange(root, range) {
  const markers = markRange(range);
  splitAtMarker(markers.end, root);
  splitAtMarker(markers.start, root);
  return markers;
}

function containsNode(range, node) {
  const probe = node.ownerDocument.createRange();
  probe.selectNode(node);
  return range.compareBoundaryPoints(0, probe) <= 0 && range.compareBoundaryPoints(2, probe) >= 0;
}

export function styleRange(root, range, property, value) {
  if (!range || range.collapsed || !root.contains(range.commonAncestorContainer)) return null;
  const { start, end } = splitInlineRange(root, range);
  const selected = rangeBetween(start, end);
  const elements = [...root.querySelectorAll('*')].filter((node) => containsNode(selected, node));
  for (const element of elements) {
    element.style.removeProperty(property);
    if (!element.style.length) element.removeAttribute('style');
    if (element.tagName === 'FONT') {
      const attribute = { color: 'color', 'font-family': 'face', 'font-size': 'size' }[property];
      if (attribute) element.removeAttribute(attribute);
    }
  }
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const texts = [];
  while (walker.nextNode()) {
    const text = walker.currentNode;
    if (text.data && selected.intersectsNode(text) && !text.parentElement.closest('style, script')) texts.push(text);
  }
  for (const text of texts) {
    let appliedValue = value;
    if (value === null) {
      // A partly selected block cannot be split just to clear its inherited style.
      // Override that property only on the selected characters instead.
      let ancestor = text.parentElement;
      while (ancestor && ancestor !== root) {
        if (ancestor.style.getPropertyValue(property)) {
          appliedValue = 'initial';
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }
    if (appliedValue !== null) {
      const span = root.ownerDocument.createElement('span');
      span.style.setProperty(property, appliedValue);
      text.replaceWith(span);
      span.append(text);
    }
  }
  normalizeInline(root);
  const result = rangeBetween(start, end);
  start.remove();
  end.remove();
  return result;
}

export function tableGrid(table) {
  const rows = [...table.rows];
  const grid = rows.map(() => []);
  const cells = new Map();
  for (let r = 0; r < rows.length; r++) {
    let c = 0;
    for (const cell of rows[r].cells) {
      while (grid[r][c]) c++;
      const groupEnd = rows.findIndex((row, index) => index > r && row.parentElement !== rows[r].parentElement);
      const remaining = (groupEnd < 0 ? rows.length : groupEnd) - r;
      const height = Math.min(cell.rowSpan === 0 ? remaining : cell.rowSpan, remaining);
      const width = cell.colSpan;
      const entry = { cell, row: r, col: c, height, width };
      cells.set(cell, entry);
      for (let y = r; y < r + height; y++) {
        for (let x = c; x < c + width; x++) {
          if (grid[y][x]) throw new Error('Table has overlapping merged cells');
          grid[y][x] = entry;
        }
      }
      c += width;
    }
  }
  return { rows, grid, cells, width: Math.max(0, ...grid.map((row) => row.length)) };
}

function setSpan(cell, name, value) {
  if (value <= 1) cell.removeAttribute(name);
  else cell.setAttribute(name, String(value));
}

function emptyCell(doc, tag = 'td') {
  const cell = doc.createElement(tag);
  cell.append(doc.createElement('br'));
  return cell;
}

function insertAt(row, col, cell, entries) {
  const next = [...row.cells].find((candidate) => entries.get(candidate)?.col >= col);
  row.insertBefore(cell, next || null);
}

export function editTable(table, cell, action) {
  const { rows, grid, cells, width } = tableGrid(table);
  const current = cells.get(cell);
  if (!current) throw new Error('Select a table cell first');
  const { row: r, col: c, height, width: spanWidth } = current;
  const doc = table.ownerDocument;
  if (action === 'merge-right' || action === 'merge-down') {
    const right = action === 'merge-right';
    const other = right ? grid[r]?.[c + spanWidth] : grid[r + height]?.[c];
    if (!other || other.cell.parentElement.parentElement !== cell.parentElement.parentElement ||
        (right ? other.row !== r || other.height !== height : other.col !== c || other.width !== spanWidth)) {
      throw new Error('Merge requires adjacent cells with matching spans in the same row group');
    }
    setSpan(cell, right ? 'colspan' : 'rowspan', right ? spanWidth + other.width : height + other.height);
    if (cell.hasChildNodes() && other.cell.hasChildNodes()) cell.append(doc.createElement('br'));
    cell.append(...other.cell.childNodes);
    other.cell.remove();
    return cell;
  }
  if (action === 'split') {
    for (let y = r; y < r + height; y++) {
      for (let x = c; x < c + spanWidth; x++) {
        if (y === r && x === c) continue;
        insertAt(rows[y], x, emptyCell(doc, cell.localName), cells);
      }
    }
    cell.removeAttribute('rowspan');
    cell.removeAttribute('colspan');
    return cell;
  }
  if (action === 'row-above' || action === 'row-below') {
    const at = action === 'row-above' ? r : r + height;
    const group = rows[r].parentElement;
    const row = doc.createElement('tr');
    // Freeze rowspan=0 at its current logical height before changing the group.
    // Otherwise the browser expands it implicitly and the added cells overlap.
    for (const entry of cells.values()) {
      if (entry.cell.rowSpan === 0) setSpan(entry.cell, 'rowspan', entry.height);
    }
    const crossing = new Set();
    for (let x = 0; x < width; x++) {
      const entry = grid[at]?.[x];
      if (entry && entry.row < at && rows[entry.row].parentElement === group) crossing.add(entry);
      else row.append(emptyCell(doc, group.tagName === 'THEAD' ? 'th' : 'td'));
    }
    for (const entry of crossing) setSpan(entry.cell, 'rowspan', entry.height + 1);
    group.insertBefore(row, rows[at]?.parentElement === group ? rows[at] : null);
    return row.cells[0] || cell;
  }
  if (action === 'col-left' || action === 'col-right') {
    const at = action === 'col-left' ? c : c + spanWidth;
    const expanded = new Set();
    let selected = null;
    rows.forEach((row, y) => {
      const entry = grid[y][at];
      if (entry && entry.col < at) expanded.add(entry);
      else {
        const added = emptyCell(doc, row.parentElement.tagName === 'THEAD' ? 'th' : 'td');
        insertAt(row, at, added, cells);
        if (y === r) selected = added;
      }
    });
    for (const entry of expanded) setSpan(entry.cell, 'colspan', entry.width + 1);
    return selected || cell;
  }
  if (action === 'delete-row') {
    if (rows.length <= 1) throw new Error('Cannot remove last row');
    for (const entry of cells.values()) {
      if (entry.row < r && entry.row + entry.height > r) setSpan(entry.cell, 'rowspan', entry.height - 1);
      else if (entry.row === r && entry.height > 1) {
        setSpan(entry.cell, 'rowspan', entry.height - 1);
        insertAt(rows[r + 1], entry.col, entry.cell, cells);
      }
    }
    rows[r].remove();
    return table.rows[Math.min(r, table.rows.length - 1)]?.cells[0] || table.querySelector('td, th');
  }
  if (action === 'delete-col') {
    if (width <= 1) throw new Error('Cannot remove last column');
    for (const entry of new Set(grid.map((row) => row[c]).filter(Boolean))) {
      if (entry.width > 1) setSpan(entry.cell, 'colspan', entry.width - 1);
      else entry.cell.remove();
    }
    return rows[r].cells[0] || table.querySelector('td, th');
  }
  throw new Error('Unknown table operation');
}
