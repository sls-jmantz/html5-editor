const STORAGE_KEY = "html5-editor-content";

const editor = document.getElementById("editor");
const htmlSource = document.getElementById("html-source");
const wrapToggle = document.getElementById("wrap-toggle");
const blockType = document.getElementById("block-type");
const fontFamily = document.getElementById("font-family");
const fontSize = document.getElementById("font-size");
const customSizeValue = document.getElementById("custom-size-value");
const customSizeUnit = document.getElementById("custom-size-unit");
const applyCustomSizeBtn = document.getElementById("apply-custom-size");
const imageWidthValue = document.getElementById("image-width-value");
const imageWidthUnit = document.getElementById("image-width-unit");
const imageDisplay = document.getElementById("image-display");
const imageAlign = document.getElementById("image-align");
const imagePadding = document.getElementById("image-padding");
const imageRadius = document.getElementById("image-radius");
const imageFit = document.getElementById("image-fit");
const wrapImageBtn = document.getElementById("wrap-image");
const resetImageStyleBtn = document.getElementById("reset-image-style");
const addTableBtn = document.getElementById("add-table");
const tableRowsInput = document.getElementById("table-rows");
const tableColsInput = document.getElementById("table-cols");
const tableAddRowAboveBtn = document.getElementById("table-add-row-above");
const tableAddRowBelowBtn = document.getElementById("table-add-row-below");
const tableAddColLeftBtn = document.getElementById("table-add-col-left");
const tableAddColRightBtn = document.getElementById("table-add-col-right");
const tableDeleteRowBtn = document.getElementById("table-delete-row");
const tableDeleteColBtn = document.getElementById("table-delete-col");
const tableDeleteBtn = document.getElementById("table-delete");
const tableMergeRightBtn = document.getElementById("table-merge-right");
const tableMergeDownBtn = document.getElementById("table-merge-down");
const tableSplitCellBtn = document.getElementById("table-split-cell");
const tableCellBgInput = document.getElementById("table-cell-bg");
const tableCellBgNoneBtn = document.getElementById("table-cell-bg-none");
const tableBgInput = document.getElementById("table-bg");
const tableBgNoneBtn = document.getElementById("table-bg-none");
const tableBorderColorInput = document.getElementById("table-border-color");
const tableBorderWidthInput = document.getElementById("table-border-width");
const tableCellPaddingInput = document.getElementById("table-cell-padding");
const tableZebraModeSelect = document.getElementById("table-zebra-mode");
const tableZebraAInput = document.getElementById("table-zebra-a");
const tableZebraBInput = document.getElementById("table-zebra-b");
const tableApplyStyleBtn = document.getElementById("table-apply-style");
const textColor = document.getElementById("text-color");
const bgColor = document.getElementById("bg-color");
const textColorNoneBtn = document.getElementById("text-color-none");
const bgColorNoneBtn = document.getElementById("bg-color-none");
const saveStatus = document.getElementById("save-status");
const copyHtmlBtn = document.getElementById("copy-html");
const clearEditorBtn = document.getElementById("clear-editor");
const linkBtn = document.getElementById("add-link");
const unlinkBtn = document.getElementById("remove-link");
const imageBtn = document.getElementById("add-image");

const defaultMarkup = `
<h1>Start editing</h1>
<p>Use the toolbar to style this text: headings, bold, lists, colors, links, and more.</p>
`.trim();

let savedRange = null;
let saveTimer;
let selectedImage = null;
let lastEditSurface = "live";
let sourceSelectionStart = 0;
let sourceSelectionEnd = 0;
let customSizeTypingTimer;
let selectedTableCell = null;
let activeTypographySpan = null;

const PRESET_SIZE_BY_PX = {
  12: "2",
  16: "3",
  18: "4",
  24: "5",
  32: "6",
};

function isSourceFocused() {
  return lastEditSurface === "source";
}

function syncSourceSelection() {
  sourceSelectionStart = htmlSource.selectionStart ?? sourceSelectionStart;
  sourceSelectionEnd = htmlSource.selectionEnd ?? sourceSelectionEnd;
}

function restoreSourceSelection() {
  htmlSource.focus();
  const max = htmlSource.value.length;
  const start = Math.min(sourceSelectionStart, max);
  const end = Math.min(sourceSelectionEnd, max);
  htmlSource.setSelectionRange(start, end);
}

function syncEditorFromSource() {
  editor.innerHTML = htmlSource.value.trim() || "<p><br></p>";
}

function normalizeFontName(value) {
  return String(value || "")
    .split(",")[0]
    .replaceAll("\"", "")
    .replaceAll("'", "")
    .trim()
    .toLowerCase();
}

function rgbToHex(colorValue) {
  const match = String(colorValue || "")
    .trim()
    .match(/^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)$/i);

  if (!match) {
    return null;
  }

  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (Number.isFinite(alpha) && alpha === 0) {
    return null;
  }

  const toHex = (n) => Number(n).toString(16).padStart(2, "0");
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
}

function getSelectionElement() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const boundaryNode = range.startContainer;
  if (boundaryNode.nodeType === Node.ELEMENT_NODE) {
    const startElNode = boundaryNode;
    const child = startElNode.childNodes[range.startOffset] || startElNode.childNodes[range.startOffset - 1];
    const childElement = child?.nodeType === Node.ELEMENT_NODE ? child : child?.parentElement;
    if (childElement && editor.contains(childElement)) {
      return childElement;
    }
  }

  const boundaryElement = boundaryNode.nodeType === Node.ELEMENT_NODE ? boundaryNode : boundaryNode.parentElement;
  if (boundaryElement && editor.contains(boundaryElement)) {
    return boundaryElement;
  }

  const node = selection.anchorNode;
  if (!node) {
    return null;
  }

  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element || !editor.contains(element)) {
    return null;
  }

  return element;
}

function updateFromSourceAndPersist() {
  syncEditorFromSource();
  queuePersist();
}

function replaceSourceSelection(replacement, selectMode = "end") {
  restoreSourceSelection();
  const start = htmlSource.selectionStart ?? 0;
  const end = htmlSource.selectionEnd ?? start;
  const current = htmlSource.value;
  htmlSource.value = `${current.slice(0, start)}${replacement}${current.slice(end)}`;

  const cursorEnd = start + replacement.length;
  if (selectMode === "select") {
    htmlSource.setSelectionRange(start, cursorEnd);
  } else {
    htmlSource.setSelectionRange(cursorEnd, cursorEnd);
  }

  syncSourceSelection();

  updateFromSourceAndPersist();
}

function wrapSourceSelection(openTag, closeTag, fallbackText = "") {
  const start = htmlSource.selectionStart ?? 0;
  const end = htmlSource.selectionEnd ?? start;
  const selected = htmlSource.value.slice(start, end) || fallbackText;
  replaceSourceSelection(`${openTag}${selected}${closeTag}`);
}

function clearImageSelection() {
  if (selectedImage) {
    selectedImage.classList.remove("is-selected-image");
  }
  selectedImage = null;
}

function setSelectedImage(image) {
  clearImageSelection();
  selectedImage = image;
  if (selectedImage) {
    selectedImage.classList.add("is-selected-image");
  }
}

function clearTableSelection() {
  if (selectedTableCell && editor.contains(selectedTableCell)) {
    selectedTableCell.classList.remove("is-selected-table-cell");
  }
  selectedTableCell = null;
}

function setSelectedTableCell(cell) {
  clearTableSelection();
  selectedTableCell = cell;
  if (selectedTableCell) {
    selectedTableCell.classList.add("is-selected-table-cell");
  }
}

function getSelectedTableCell() {
  if (selectedTableCell && editor.contains(selectedTableCell)) {
    return selectedTableCell;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const anchor = selection.anchorNode;
  if (!anchor) {
    return null;
  }

  const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement;
  if (!element || !editor.contains(element)) {
    return null;
  }

  return element.closest("td, th");
}

function getSelectedTable() {
  const cell = getSelectedTableCell();
  if (cell) {
    return cell.closest("table");
  }
  return null;
}

function getSelectedImage() {
  if (selectedImage && editor.contains(selectedImage)) {
    return selectedImage;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const directNode = range.startContainer;
  if (directNode && directNode.nodeType === Node.ELEMENT_NODE && directNode.tagName === "IMG") {
    return directNode;
  }

  if (directNode && directNode.nodeType === Node.ELEMENT_NODE) {
    const childAtOffset = directNode.childNodes[range.startOffset] || directNode.childNodes[range.startOffset - 1];
    if (childAtOffset && childAtOffset.nodeType === Node.ELEMENT_NODE && childAtOffset.tagName === "IMG") {
      return childAtOffset;
    }
  }

  const node = selection.anchorNode;
  if (!node) {
    return null;
  }

  const base = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!base) {
    return null;
  }

  return base.closest("img");
}

function saveSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  savedRange = selection.getRangeAt(0).cloneRange();
  const anchorNode = selection.anchorNode;
  if (anchorNode && editor.contains(anchorNode)) {
    const anchorElement = anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement;
    activeTypographySpan = anchorElement?.closest("span[data-typo-span='1']") || null;
  }
}

function restoreSelection() {
  if (!savedRange) {
    return;
  }
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedRange);
}

function syncOutput() {
  htmlSource.value = editor.innerHTML.trim();
}

function unwrapNode(node) {
  const parent = node.parentNode;
  if (!parent) {
    return;
  }
  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node);
  }
  parent.removeChild(node);
}

function canonicalizeStyleAttribute(element) {
  const styleAttr = element.getAttribute("style") || "";
  if (!styleAttr.trim()) {
    return;
  }

  const parts = styleAttr
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf(":");
      if (index === -1) {
        return null;
      }
      const name = part.slice(0, index).trim().toLowerCase();
      const value = part.slice(index + 1).trim();
      if (!name || !value) {
        return null;
      }
      return `${name}:${value}`;
    })
    .filter(Boolean)
    .sort();

  if (parts.length === 0) {
    element.removeAttribute("style");
    return;
  }

  element.setAttribute("style", `${parts.join(";")};`);
}

function normalizeTypographyMarkup() {
  const spans = [...editor.querySelectorAll("span")];

  spans.forEach((span) => {
    if (span.dataset.typoSpan !== "1") {
      return;
    }

    canonicalizeStyleAttribute(span);

    const styleText = span.getAttribute("style") || "";
    if (!styleText.trim()) {
      span.removeAttribute("style");
      unwrapNode(span);
    }
  });

  [...editor.querySelectorAll("span[data-typo-span='1']")].forEach((span) => {
    let next = span.nextSibling;
    while (next && next.nodeType === Node.TEXT_NODE && !next.textContent.trim()) {
      next = next.nextSibling;
    }

    if (!(next instanceof HTMLSpanElement)) {
      return;
    }

    if (next.dataset.typoSpan !== "1") {
      return;
    }

    const aStyle = span.getAttribute("style") || "";
    const bStyle = next.getAttribute("style") || "";
    if (aStyle !== bStyle) {
      return;
    }

    while (next.firstChild) {
      span.appendChild(next.firstChild);
    }
    next.remove();
  });
}

function setSaveStatus(text, isSaved = false) {
  saveStatus.textContent = text;
  saveStatus.classList.toggle("saved", isSaved);
}

function persist() {
  localStorage.setItem(STORAGE_KEY, htmlSource.value.trim());
  setSaveStatus("Saved locally", true);
}

function queuePersist() {
  setSaveStatus("Saving...", false);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, 280);
}

function runCommand(cmd, value = null) {
  if (isSourceFocused()) {
    applySourceCommand(cmd, value);
    return;
  }

  editor.focus();
  restoreSelection();
  document.execCommand("styleWithCSS", false, true);
  document.execCommand(cmd, false, value);
  syncOutput();
  refreshActiveStates();
  queuePersist();
}

function getSelectionRangeInEditor() {
  editor.focus();
  restoreSelection();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    return null;
  }
  return range;
}

function getExistingStyleSpan(range) {
  const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const endEl = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
  if (!startEl || !endEl) {
    return null;
  }

  const startSpan = startEl.closest("span");
  const endSpan = endEl.closest("span");
  if (!startSpan || startSpan !== endSpan || !editor.contains(startSpan)) {
    return null;
  }

  const spanRange = document.createRange();
  spanRange.selectNodeContents(startSpan);
  const isSameStart = range.compareBoundaryPoints(Range.START_TO_START, spanRange) === 0;
  const isSameEnd = range.compareBoundaryPoints(Range.END_TO_END, spanRange) === 0;
  if (!isSameStart || !isSameEnd) {
    return null;
  }

  return startSpan;
}

function getContainingTypoSpan(range) {
  const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const endEl = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
  if (!startEl || !endEl) {
    return null;
  }

  const startSpan = startEl.closest("span[data-typo-span='1']");
  const endSpan = endEl.closest("span[data-typo-span='1']");
  if (!startSpan || startSpan !== endSpan || !editor.contains(startSpan)) {
    return null;
  }

  return startSpan;
}

function applyInlineStyle(property, value, silent = false) {
  if (isSourceFocused()) {
    const cssProp = property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    wrapSourceSelection(`<span style=\"${cssProp}:${value}\">`, "</span>", "text");
    return true;
  }

  const range = getSelectionRangeInEditor();
  const hasTextSelection = !!range && !range.collapsed;

  let target = null;
  if (hasTextSelection) {
    target = getExistingStyleSpan(range);

    if (!target && range) {
      const containingSpan = getContainingTypoSpan(range);
      if (containingSpan && containingSpan.style[property]) {
        target = containingSpan;
      }
    }
  } else if (activeTypographySpan && editor.contains(activeTypographySpan)) {
    target = activeTypographySpan;
  }

  if (!hasTextSelection && !target) {
    if (!silent) {
      setSaveStatus("Select text to apply typography", false);
    }
    return false;
  }

  if (!target && range) {
    target = document.createElement("span");
    target.dataset.typoSpan = "1";
    target.appendChild(range.extractContents());
    range.insertNode(target);
  }

  if (!target) {
    return false;
  }

  target.style[property] = value;
  normalizeTypographyMarkup();
  if (!target.isConnected || !editor.contains(target)) {
    activeTypographySpan = null;
  } else {
    activeTypographySpan = target;
  }

  const updatedRange = document.createRange();
  updatedRange.selectNodeContents(activeTypographySpan || target);
  savedRange = updatedRange.cloneRange();

  syncOutput();
  refreshActiveStates();
  queuePersist();
  return true;
}

function stripCssPropertyFromFragment(fragment, cssProperty) {
  const template = document.createElement("template");
  template.innerHTML = fragment;

  template.content.querySelectorAll("[style]").forEach((element) => {
    element.style.removeProperty(cssProperty);
    const styleText = element.getAttribute("style") || "";
    if (!styleText.trim()) {
      element.removeAttribute("style");
    }
  });

  return template.innerHTML;
}

function clearInlineStyle(property, silent = false) {
  if (isSourceFocused()) {
    restoreSourceSelection();
    const start = htmlSource.selectionStart ?? 0;
    const end = htmlSource.selectionEnd ?? start;
    if (start === end) {
      if (!silent) {
        setSaveStatus("Select text to clear style", false);
      }
      return false;
    }

    const cssProp = property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    const selected = htmlSource.value.slice(start, end);
    const cleaned = stripCssPropertyFromFragment(selected, cssProp);
    replaceSourceSelection(cleaned, "select");
    return true;
  }

  const range = getSelectionRangeInEditor();
  if (!range || range.collapsed) {
    if (!silent) {
      setSaveStatus("Select text to clear style", false);
    }
    return false;
  }

  const target = getExistingStyleSpan(range);
  if (!target) {
    if (!silent) {
      setSaveStatus("No style wrapper selected", false);
    }
    return false;
  }

  target.style[property] = "";
  if (!(target.getAttribute("style") || "").trim()) {
    target.removeAttribute("style");
  }

  normalizeTypographyMarkup();
  saveSelection();
  syncOutput();
  refreshActiveStates();
  queuePersist();
  return true;
}

function applySourceCommand(cmd, value = null) {
  if (cmd === "bold") {
    wrapSourceSelection("<strong>", "</strong>", "text");
  } else if (cmd === "italic") {
    wrapSourceSelection("<em>", "</em>", "text");
  } else if (cmd === "underline") {
    wrapSourceSelection("<u>", "</u>", "text");
  } else if (cmd === "strikeThrough") {
    wrapSourceSelection("<s>", "</s>", "text");
  } else if (cmd === "insertUnorderedList") {
    wrapSourceSelection("<ul><li>", "</li></ul>", "item");
  } else if (cmd === "insertOrderedList") {
    wrapSourceSelection("<ol><li>", "</li></ol>", "item");
  } else if (cmd === "justifyLeft" || cmd === "justifyCenter" || cmd === "justifyRight") {
    const map = { justifyLeft: "left", justifyCenter: "center", justifyRight: "right" };
    wrapSourceSelection(`<div style=\"text-align:${map[cmd]}\">`, "</div>", "text");
  } else if (cmd === "undo" || cmd === "redo") {
    htmlSource.focus();
    document.execCommand(cmd, false, null);
    updateFromSourceAndPersist();
  } else if (cmd === "removeFormat") {
    const start = htmlSource.selectionStart ?? 0;
    const end = htmlSource.selectionEnd ?? start;
    const selected = htmlSource.value.slice(start, end);
    const stripped = selected.replace(/<[^>]+>/g, "");
    replaceSourceSelection(stripped);
  }
}

function refreshActiveStates() {
  const commandButtons = document.querySelectorAll("button[data-cmd]");

  commandButtons.forEach((btn) => {
    const cmd = btn.dataset.cmd;
    if (!cmd) {
      return;
    }

    let active = false;
    try {
      active = document.queryCommandState(cmd);
    } catch {
      active = false;
    }
    btn.classList.toggle("is-active", active);
  });

  try {
    const currentBlock = (document.queryCommandValue("formatBlock") || "P").replace(/[<>]/g, "").toUpperCase();
    const blockOption = [...blockType.options].find((item) => item.value === currentBlock);
    blockType.value = blockOption ? blockOption.value : "P";
  } catch {
    blockType.value = "P";
  }

  try {
    const currentFont = (document.queryCommandValue("fontName") || "").replaceAll('"', "");
    const fontOption = [...fontFamily.options].find((item) => item.value.split(",")[0].replaceAll("'", "") === currentFont);
    fontFamily.value = fontOption ? fontOption.value : "";
  } catch {
    fontFamily.value = "";
  }

  try {
    const currentSize = String(document.queryCommandValue("fontSize") || "");
    const sizeOption = [...fontSize.options].find((item) => item.value === currentSize);
    fontSize.value = sizeOption ? sizeOption.value : "";
  } catch {
    fontSize.value = "";
  }
}

function syncTypographyControls() {
  const element = getSelectionElement();
  if (!element) {
    return;
  }

  const computed = window.getComputedStyle(element);

  const currentFont = normalizeFontName(computed.fontFamily);
  const fontOption = [...fontFamily.options].find((item) => normalizeFontName(item.value) === currentFont);
  fontFamily.value = fontOption ? fontOption.value : "";

  const px = Math.round(Number.parseFloat(computed.fontSize) || 16);
  fontSize.value = PRESET_SIZE_BY_PX[px] || "";
  customSizeValue.value = String(px);
  customSizeUnit.value = "px";

  const textHex = rgbToHex(computed.color);
  if (textHex) {
    textColor.value = textHex;
  }

  const bgHex = rgbToHex(computed.backgroundColor);
  if (bgHex) {
    bgColor.value = bgHex;
  }
}

function promptAndInsertLink() {
  const url = window.prompt("Enter link URL", "https://");
  if (!url) {
    return;
  }

  if (isSourceFocused()) {
    const safeUrl = url.trim().replaceAll('"', "&quot;");
    wrapSourceSelection(`<a href=\"${safeUrl}\">`, "</a>", "link");
    return;
  }

  runCommand("createLink", url.trim());
}

function applyCustomFontSize(silent = false) {
  const rawValue = Number(customSizeValue.value);
  const unit = customSizeUnit.value;
  const allowedUnits = ["px", "rem", "em", "%", "pt"];

  if (!Number.isFinite(rawValue) || rawValue <= 0 || !allowedUnits.includes(unit)) {
    if (!silent) {
      setSaveStatus("Enter a valid size value", false);
    }
    return;
  }

  applyInlineStyle("fontSize", `${rawValue}${unit}`, silent);
}

function syncImageControls() {
  const image = getSelectedImage();
  if (!image || !editor.contains(image)) {
    return;
  }

  const inlineWidth = image.style.width || "";
  const computed = window.getComputedStyle(image);
  if (inlineWidth.endsWith("%")) {
    imageWidthValue.value = String(Math.round(Number.parseFloat(inlineWidth) || 100));
    imageWidthUnit.value = "%";
  } else if (inlineWidth.endsWith("px")) {
    imageWidthValue.value = String(Math.round(Number.parseFloat(inlineWidth) || 100));
    imageWidthUnit.value = "px";
  } else {
    imageWidthValue.value = String(Math.max(1, Math.round(Number.parseFloat(computed.width) || 100)));
    imageWidthUnit.value = "px";
  }

  imageDisplay.value = (image.style.display || computed.display) === "inline-block" ? "inline-block" : "block";
  imagePadding.value = image.style.padding ? String(Math.round(Number.parseFloat(image.style.padding) || 0)) : "0";
  imageRadius.value = image.style.borderRadius ? String(Math.round(Number.parseFloat(image.style.borderRadius) || 0)) : "0";
  imageFit.value = image.style.objectFit || "";

  const marginLeft = image.style.marginLeft;
  const marginRight = image.style.marginRight;
  if (marginLeft === "auto" && marginRight === "auto") {
    imageAlign.value = "center";
  } else if (marginLeft === "auto") {
    imageAlign.value = "right";
  } else {
    imageAlign.value = "left";
  }
}

function applyImageStyles(silent = false) {
  const image = getSelectedImage();
  if (!image || !editor.contains(image)) {
    if (!silent) {
      setSaveStatus("Select an image first", false);
    }
    return;
  }

  setSelectedImage(image);

  const widthNumber = Number(imageWidthValue.value);
  const widthUnit = imageWidthUnit.value;
  if (Number.isFinite(widthNumber) && widthNumber > 0) {
    image.style.width = `${widthNumber}${widthUnit}`;
  }

  image.style.maxWidth = "100%";
  image.style.height = "auto";
  image.style.padding = `${Math.max(0, Number(imagePadding.value) || 0)}px`;
  image.style.borderRadius = `${Math.max(0, Number(imageRadius.value) || 0)}px`;
  image.style.objectFit = imageFit.value;
  image.style.display = imageDisplay.value;

  if (imageDisplay.value === "inline-block") {
    image.style.marginLeft = "0";
    image.style.marginRight = "0";
  } else if (imageAlign.value === "center") {
    image.style.marginLeft = "auto";
    image.style.marginRight = "auto";
  } else if (imageAlign.value === "right") {
    image.style.marginLeft = "auto";
    image.style.marginRight = "0";
  } else {
    image.style.marginLeft = "0";
    image.style.marginRight = "auto";
  }

  syncOutput();
  queuePersist();
  if (!silent) {
    setSaveStatus("Image styled", true);
  }
}

function wrapImageInFrame() {
  const image = getSelectedImage();
  if (!image || !editor.contains(image)) {
    setSaveStatus("Select an image first", false);
    return;
  }

  const parent = image.parentElement;
  if (parent && parent.classList.contains("image-frame")) {
    parent.parentElement.insertBefore(image, parent);
    if (!parent.querySelector("img")) {
      parent.remove();
    }
    syncOutput();
    queuePersist();
    setSaveStatus("Removed image frame", true);
    return;
  }

  const frame = document.createElement("div");
  frame.className = "image-frame";
  parent.insertBefore(frame, image);
  frame.appendChild(image);

  syncOutput();
  queuePersist();
  setSaveStatus("Wrapped image in frame", true);
}

function resetImageStyles() {
  const image = getSelectedImage();
  if (!image || !editor.contains(image)) {
    setSaveStatus("Select an image first", false);
    return;
  }

  setSelectedImage(image);
  image.removeAttribute("style");
  image.style.maxWidth = "100%";
  image.style.height = "auto";

  syncImageControls();
  syncOutput();
  queuePersist();
  setSaveStatus("Image styles reset", true);
}

function buildTableHtml(rows, cols) {
  const safeRows = Math.min(20, Math.max(1, rows));
  const safeCols = Math.min(12, Math.max(1, cols));
  const bodyRows = Array.from({ length: safeRows }, (_, rowIndex) => {
    const cells = Array.from({ length: safeCols }, (_, colIndex) => `<td>Cell ${rowIndex + 1}-${colIndex + 1}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  return `<table style="border-collapse:collapse;width:100%;"><tbody>${bodyRows}</tbody></table><p><br></p>`;
}

function insertTableAtCursor() {
  const rows = Number(tableRowsInput.value) || 3;
  const cols = Number(tableColsInput.value) || 3;
  const markup = buildTableHtml(rows, cols);

  if (isSourceFocused()) {
    replaceSourceSelection(markup);
    setSaveStatus("Table inserted in HTML source", true);
    return;
  }

  editor.focus();
  restoreSelection();
  document.execCommand("insertHTML", false, markup);
  syncOutput();
  queuePersist();
  setSaveStatus("Table inserted", true);
}

function getCellContext() {
  const cell = getSelectedTableCell();
  if (!cell || !editor.contains(cell)) {
    return null;
  }
  const row = cell.parentElement;
  const table = cell.closest("table");
  if (!row || !table) {
    return null;
  }
  const cellsInRow = [...row.children].filter((item) => item.matches("td, th"));
  const colIndex = cellsInRow.indexOf(cell);
  return { cell, row, table, colIndex };
}

function makeEmptyCell() {
  const cell = document.createElement("td");
  cell.innerHTML = "<br>";
  return cell;
}

function insertTableRow(position) {
  const context = getCellContext();
  if (!context) {
    setSaveStatus("Select a table cell first", false);
    return;
  }

  const { row, table, colIndex } = context;
  const referenceCells = [...row.children].filter((item) => item.matches("td, th"));
  const newRow = document.createElement("tr");
  referenceCells.forEach(() => newRow.appendChild(makeEmptyCell()));

  if (position === "above") {
    row.parentElement.insertBefore(newRow, row);
  } else {
    row.parentElement.insertBefore(newRow, row.nextSibling);
  }

  const nextSelected = newRow.children[Math.max(0, colIndex)] || newRow.children[0];
  setSelectedTableCell(nextSelected);
  syncTableControls();
  syncOutput();
  queuePersist();
}

function insertTableColumn(side) {
  const context = getCellContext();
  if (!context) {
    setSaveStatus("Select a table cell first", false);
    return;
  }

  const { table, colIndex } = context;
  const insertAt = side === "left" ? colIndex : colIndex + 1;

  [...table.rows].forEach((row) => {
    const cells = [...row.children].filter((item) => item.matches("td, th"));
    const refNode = cells[insertAt] || null;
    row.insertBefore(makeEmptyCell(), refNode);
  });

  const selectRow = context.row.rowIndex;
  const selectedRow = table.rows[selectRow] || table.rows[0];
  const targetIndex = side === "left" ? insertAt : insertAt;
  setSelectedTableCell(selectedRow?.children[targetIndex] || selectedRow?.children[0] || null);
  syncTableControls();
  syncOutput();
  queuePersist();
}

function deleteTableRow() {
  const context = getCellContext();
  if (!context) {
    setSaveStatus("Select a table cell first", false);
    return;
  }

  const { row, table, colIndex } = context;
  if (table.rows.length <= 1) {
    setSaveStatus("Cannot remove last row", false);
    return;
  }

  const rowIndex = row.rowIndex;
  row.remove();
  const fallbackRow = table.rows[Math.max(0, rowIndex - 1)] || table.rows[0];
  const fallbackCell = fallbackRow?.children[Math.min(colIndex, fallbackRow.children.length - 1)] || null;
  setSelectedTableCell(fallbackCell);
  syncTableControls();
  syncOutput();
  queuePersist();
}

function deleteTableColumn() {
  const context = getCellContext();
  if (!context) {
    setSaveStatus("Select a table cell first", false);
    return;
  }

  const { table, colIndex } = context;
  if (!table.rows[0] || table.rows[0].cells.length <= 1) {
    setSaveStatus("Cannot remove last column", false);
    return;
  }

  [...table.rows].forEach((row) => {
    if (row.children[colIndex]) {
      row.children[colIndex].remove();
    }
  });

  const selectedRow = table.rows[context.row.rowIndex] || table.rows[0];
  const fallbackCell = selectedRow?.children[Math.max(0, colIndex - 1)] || selectedRow?.children[0] || null;
  setSelectedTableCell(fallbackCell);
  syncTableControls();
  syncOutput();
  queuePersist();
}

function deleteSelectedTable() {
  const table = getSelectedTable();
  if (!table || !editor.contains(table)) {
    setSaveStatus("Select a table cell first", false);
    return;
  }

  clearTableSelection();
  table.remove();
  syncOutput();
  queuePersist();
  setSaveStatus("Table deleted", true);
}

function mergeCellRight() {
  const context = getCellContext();
  if (!context) {
    setSaveStatus("Select a table cell first", false);
    return;
  }

  const { cell } = context;
  const rightCell = cell.nextElementSibling;
  if (!(rightCell instanceof HTMLTableCellElement)) {
    setSaveStatus("No cell to the right", false);
    return;
  }

  const currentColSpan = Number(cell.getAttribute("colspan") || "1");
  const rightColSpan = Number(rightCell.getAttribute("colspan") || "1");
  cell.setAttribute("colspan", String(currentColSpan + rightColSpan));

  if (rightCell.innerHTML.trim()) {
    if (cell.innerHTML.trim()) {
      cell.insertAdjacentHTML("beforeend", "<br>");
    }
    cell.insertAdjacentHTML("beforeend", rightCell.innerHTML);
  }

  rightCell.remove();
  setSelectedTableCell(cell);
  syncTableControls();
  syncOutput();
  queuePersist();
  setSaveStatus("Merged cell to the right", true);
}

function mergeCellDown() {
  const context = getCellContext();
  if (!context) {
    setSaveStatus("Select a table cell first", false);
    return;
  }

  const { cell, row } = context;
  const nextRow = row.nextElementSibling;
  if (!(nextRow instanceof HTMLTableRowElement)) {
    setSaveStatus("No row below to merge", false);
    return;
  }

  const downCell = nextRow.cells[cell.cellIndex];
  if (!(downCell instanceof HTMLTableCellElement)) {
    setSaveStatus("No matching cell below", false);
    return;
  }

  const currentRowSpan = Number(cell.getAttribute("rowspan") || "1");
  const downRowSpan = Number(downCell.getAttribute("rowspan") || "1");
  cell.setAttribute("rowspan", String(currentRowSpan + downRowSpan));

  if (downCell.innerHTML.trim()) {
    if (cell.innerHTML.trim()) {
      cell.insertAdjacentHTML("beforeend", "<br>");
    }
    cell.insertAdjacentHTML("beforeend", downCell.innerHTML);
  }

  downCell.remove();
  setSelectedTableCell(cell);
  syncTableControls();
  syncOutput();
  queuePersist();
  setSaveStatus("Merged cell downward", true);
}

function splitSelectedCell() {
  const context = getCellContext();
  if (!context) {
    setSaveStatus("Select a table cell first", false);
    return;
  }

  const { cell, row, table } = context;
  const colSpan = Number(cell.getAttribute("colspan") || "1");
  const rowSpan = Number(cell.getAttribute("rowspan") || "1");

  if (colSpan <= 1 && rowSpan <= 1) {
    setSaveStatus("Cell is not merged", false);
    return;
  }

  if (colSpan > 1) {
    cell.setAttribute("colspan", String(colSpan - 1));
    const newCell = makeEmptyCell();
    row.insertBefore(newCell, cell.nextSibling);
  }

  if (rowSpan > 1) {
    cell.setAttribute("rowspan", String(rowSpan - 1));
    const targetRow = table.rows[row.rowIndex + 1];
    if (targetRow) {
      const newCell = makeEmptyCell();
      const insertBeforeNode = targetRow.cells[cell.cellIndex] || null;
      targetRow.insertBefore(newCell, insertBeforeNode);
    }
  }

  if (Number(cell.getAttribute("colspan") || "1") <= 1) {
    cell.removeAttribute("colspan");
  }
  if (Number(cell.getAttribute("rowspan") || "1") <= 1) {
    cell.removeAttribute("rowspan");
  }

  setSelectedTableCell(cell);
  syncTableControls();
  syncOutput();
  queuePersist();
  setSaveStatus("Split merged cell", true);
}

function applyTableStyles(silent = false) {
  const table = getSelectedTable();
  if (!table || !editor.contains(table)) {
    if (!silent) {
      setSaveStatus("Select a table cell first", false);
    }
    return;
  }

  const borderWidth = Math.max(0, Number(tableBorderWidthInput.value) || 0);
  const borderColor = tableBorderColorInput.value;
  const cellPadding = Math.max(0, Number(tableCellPaddingInput.value) || 0);
  const zebraMode = tableZebraModeSelect.value;
  const zebraA = tableZebraAInput.value;
  const zebraB = tableZebraBInput.value;

  table.style.borderCollapse = "collapse";
  table.style.backgroundColor = tableBgInput.value || "";
  table.dataset.zebra = zebraMode;
  table.dataset.zebraA = zebraA;
  table.dataset.zebraB = zebraB;

  [...table.rows].forEach((row, index) => {
    if (zebraMode === "on") {
      row.style.backgroundColor = index % 2 === 0 ? zebraA : zebraB;
    } else {
      row.style.backgroundColor = "";
    }

    [...row.cells].forEach((cell) => {
      cell.style.border = `${borderWidth}px solid ${borderColor}`;
      cell.style.padding = `${cellPadding}px`;
    });
  });

  syncOutput();
  queuePersist();
  if (!silent) {
    setSaveStatus("Table style updated", true);
  }
}

function setCellBackground(value) {
  const cell = getSelectedTableCell();
  if (!cell || !editor.contains(cell)) {
    setSaveStatus("Select a table cell first", false);
    return;
  }
  setSelectedTableCell(cell);
  cell.style.backgroundColor = value;
  syncOutput();
  queuePersist();
  setSaveStatus(value ? "Cell color updated" : "Cell color cleared", true);
}

function syncTableControls() {
  const context = getCellContext();
  if (!context) {
    return;
  }

  const { table, cell } = context;
  tableRowsInput.value = String(Math.max(1, table.rows.length));
  tableColsInput.value = String(Math.max(1, table.rows[0]?.cells.length || 1));

  const tableComputed = window.getComputedStyle(table);
  const cellComputed = window.getComputedStyle(cell);

  const tableBgHex = rgbToHex(table.style.backgroundColor || tableComputed.backgroundColor);
  if (tableBgHex) {
    tableBgInput.value = tableBgHex;
  }

  const cellBgHex = rgbToHex(cell.style.backgroundColor || cellComputed.backgroundColor);
  if (cellBgHex) {
    tableCellBgInput.value = cellBgHex;
  }

  const borderColorHex = rgbToHex(cellComputed.borderTopColor);
  if (borderColorHex) {
    tableBorderColorInput.value = borderColorHex;
  }

  tableBorderWidthInput.value = String(Math.max(0, Math.round(Number.parseFloat(cellComputed.borderTopWidth) || 0)));
  tableCellPaddingInput.value = String(Math.max(0, Math.round(Number.parseFloat(cellComputed.paddingTop) || 0)));

  tableZebraModeSelect.value = table.dataset.zebra === "on" ? "on" : "off";
  if (table.dataset.zebraA) {
    tableZebraAInput.value = table.dataset.zebraA;
  }
  if (table.dataset.zebraB) {
    tableZebraBInput.value = table.dataset.zebraB;
  }
}

document.querySelectorAll("button[data-cmd]").forEach((btn) => {
  btn.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  btn.addEventListener("click", () => runCommand(btn.dataset.cmd));
});

htmlSource.addEventListener("focus", () => {
  lastEditSurface = "source";
  syncSourceSelection();
});

editor.addEventListener("focus", () => {
  lastEditSurface = "live";
});

document.querySelectorAll(".toolbar input[type='number']").forEach((input) => {
  input.dataset.skipAutoSelect = "0";

  input.addEventListener("mousedown", (event) => {
    const rect = input.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const spinnerZoneWidth = Math.max(20, Math.round(rect.width * 0.24));
    const isSpinnerClick = clickX >= rect.width - spinnerZoneWidth;
    input.dataset.skipAutoSelect = isSpinnerClick ? "1" : "0";
  });

  input.addEventListener("click", () => {
    if (input.dataset.skipAutoSelect === "1") {
      input.dataset.skipAutoSelect = "0";
      return;
    }
    input.select();
  });
});

blockType.addEventListener("change", () => runCommand("formatBlock", blockType.value));

fontFamily.addEventListener("change", () => {
  if (!fontFamily.value) {
    runCommand("removeFormat");
    return;
  }
  applyInlineStyle("fontFamily", fontFamily.value);
});

fontSize.addEventListener("change", () => {
  if (!fontSize.value) {
    runCommand("removeFormat");
    return;
  }
  const sizeMap = { "2": "12px", "3": "16px", "4": "18px", "5": "24px", "6": "32px" };
  applyInlineStyle("fontSize", sizeMap[fontSize.value] || "16px");
});

applyCustomSizeBtn.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

applyCustomSizeBtn.addEventListener("click", applyCustomFontSize);
customSizeValue.addEventListener("input", () => {
  window.clearTimeout(customSizeTypingTimer);
  customSizeTypingTimer = window.setTimeout(() => {
    applyCustomFontSize(true);
  }, 420);
});
customSizeValue.addEventListener("change", () => {
  window.clearTimeout(customSizeTypingTimer);
  applyCustomFontSize(true);
});
customSizeUnit.addEventListener("change", () => applyCustomFontSize(true));

[addTableBtn, tableAddRowAboveBtn, tableAddRowBelowBtn, tableAddColLeftBtn, tableAddColRightBtn, tableDeleteRowBtn, tableDeleteColBtn, tableDeleteBtn, tableMergeRightBtn, tableMergeDownBtn, tableSplitCellBtn, tableCellBgNoneBtn, tableBgNoneBtn, tableApplyStyleBtn].forEach((button) => {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
});

addTableBtn.addEventListener("click", insertTableAtCursor);
tableAddRowAboveBtn.addEventListener("click", () => insertTableRow("above"));
tableAddRowBelowBtn.addEventListener("click", () => insertTableRow("below"));
tableAddColLeftBtn.addEventListener("click", () => insertTableColumn("left"));
tableAddColRightBtn.addEventListener("click", () => insertTableColumn("right"));
tableDeleteRowBtn.addEventListener("click", deleteTableRow);
tableDeleteColBtn.addEventListener("click", deleteTableColumn);
tableDeleteBtn.addEventListener("click", deleteSelectedTable);
tableMergeRightBtn.addEventListener("click", mergeCellRight);
tableMergeDownBtn.addEventListener("click", mergeCellDown);
tableSplitCellBtn.addEventListener("click", splitSelectedCell);
tableApplyStyleBtn.addEventListener("click", () => applyTableStyles());

tableCellBgInput.addEventListener("input", () => setCellBackground(tableCellBgInput.value));
tableCellBgNoneBtn.addEventListener("click", () => setCellBackground(""));

tableBgInput.addEventListener("input", () => {
  const table = getSelectedTable();
  if (!table || !editor.contains(table)) {
    return;
  }
  table.style.backgroundColor = tableBgInput.value;
  syncOutput();
  queuePersist();
});

tableBgNoneBtn.addEventListener("click", () => {
  const table = getSelectedTable();
  if (!table || !editor.contains(table)) {
    setSaveStatus("Select a table cell first", false);
    return;
  }
  table.style.backgroundColor = "";
  syncOutput();
  queuePersist();
  setSaveStatus("Table background cleared", true);
});

tableBorderColorInput.addEventListener("input", () => applyTableStyles(true));
tableBorderWidthInput.addEventListener("input", () => applyTableStyles(true));
tableCellPaddingInput.addEventListener("input", () => applyTableStyles(true));
tableZebraModeSelect.addEventListener("change", () => applyTableStyles(true));
tableZebraAInput.addEventListener("input", () => applyTableStyles(true));
tableZebraBInput.addEventListener("input", () => applyTableStyles(true));

wrapImageBtn.addEventListener("mousedown", (event) => {
  event.preventDefault();
});
resetImageStyleBtn.addEventListener("mousedown", (event) => {
  event.preventDefault();
});
wrapImageBtn.addEventListener("click", wrapImageInFrame);
resetImageStyleBtn.addEventListener("click", resetImageStyles);

imageWidthValue.addEventListener("input", () => applyImageStyles(true));
imageWidthUnit.addEventListener("change", () => applyImageStyles(true));
imageDisplay.addEventListener("change", () => applyImageStyles(true));
imageAlign.addEventListener("change", () => applyImageStyles(true));
imagePadding.addEventListener("input", () => applyImageStyles(true));
imageRadius.addEventListener("input", () => applyImageStyles(true));
imageFit.addEventListener("change", () => applyImageStyles(true));

textColor.addEventListener("input", () => {
  applyInlineStyle("color", textColor.value, true);
});

bgColor.addEventListener("input", () => {
  applyInlineStyle("backgroundColor", bgColor.value, true);
});

textColorNoneBtn.addEventListener("click", () => {
  clearInlineStyle("color");
});

bgColorNoneBtn.addEventListener("click", () => {
  clearInlineStyle("backgroundColor");
});

textColorNoneBtn.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

bgColorNoneBtn.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

function releaseColorLocks() {
  textColor.disabled = false;
  bgColor.disabled = false;
}

textColor.addEventListener("click", () => {
  releaseColorLocks();
  bgColor.blur();
});

bgColor.addEventListener("click", () => {
  releaseColorLocks();
  textColor.blur();
});

textColor.addEventListener("focus", () => {
  bgColor.blur();
  bgColor.disabled = true;
});

bgColor.addEventListener("focus", () => {
  textColor.blur();
  textColor.disabled = true;
});

textColor.addEventListener("change", releaseColorLocks);
bgColor.addEventListener("change", releaseColorLocks);
textColor.addEventListener("blur", releaseColorLocks);
bgColor.addEventListener("blur", releaseColorLocks);

linkBtn.addEventListener("click", promptAndInsertLink);
unlinkBtn.addEventListener("click", () => runCommand("unlink"));

imageBtn.addEventListener("click", () => {
  const url = window.prompt("Enter image URL", "https://");
  if (!url) {
    return;
  }

  if (isSourceFocused()) {
    const safeUrl = url.trim().replaceAll('"', "&quot;");
    replaceSourceSelection(`<img src=\"${safeUrl}\" alt=\"\">`);
    setSaveStatus("Image inserted in HTML source", true);
    return;
  }

  runCommand("insertImage", url.trim());
  clearTableSelection();
  setSaveStatus("Image inserted - select it to style", true);
});

copyHtmlBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(htmlSource.value.trim());
    copyHtmlBtn.textContent = "Copied";
    window.setTimeout(() => {
      copyHtmlBtn.textContent = "Copy HTML";
    }, 1200);
  } catch {
    copyHtmlBtn.textContent = "Clipboard blocked";
    window.setTimeout(() => {
      copyHtmlBtn.textContent = "Copy HTML";
    }, 1400);
  }
});

clearEditorBtn.addEventListener("click", () => {
  editor.innerHTML = "<p><br></p>";
  htmlSource.value = editor.innerHTML;
  clearImageSelection();
  clearTableSelection();
  editor.focus();
  syncOutput();
  queuePersist();
});

editor.addEventListener("input", () => {
  syncOutput();
  queuePersist();
});

htmlSource.addEventListener("input", () => {
  clearImageSelection();
  clearTableSelection();
  syncEditorFromSource();
  syncSourceSelection();
  queuePersist();
});

htmlSource.addEventListener("click", syncSourceSelection);
htmlSource.addEventListener("keyup", syncSourceSelection);
htmlSource.addEventListener("select", syncSourceSelection);

wrapToggle.addEventListener("change", () => {
  htmlSource.classList.toggle("no-wrap", !wrapToggle.checked);
  htmlSource.wrap = wrapToggle.checked ? "soft" : "off";
});

editor.addEventListener("mouseup", () => {
  lastEditSurface = "live";
  saveSelection();
  refreshActiveStates();
  syncTypographyControls();
  syncTableControls();
  syncImageControls();
});

editor.addEventListener("keyup", () => {
  lastEditSurface = "live";
  saveSelection();
  refreshActiveStates();
  syncTypographyControls();
  syncTableControls();
  syncImageControls();
});

editor.addEventListener("click", (event) => {
  const target = event.target;
  if (target instanceof HTMLImageElement) {
    clearTableSelection();
    setSelectedImage(target);
    syncImageControls();
    setSaveStatus("Image selected", true);
  } else if (target instanceof HTMLTableCellElement) {
    clearImageSelection();
    setSelectedTableCell(target);
    syncTableControls();
    setSaveStatus("Table cell selected", true);
  } else {
    if (selectedImage) {
      clearImageSelection();
    }
    if (selectedTableCell) {
      clearTableSelection();
    }
  }
});

document.addEventListener("selectionchange", () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  if (editor.contains(selection.anchorNode)) {
    saveSelection();
    refreshActiveStates();
    syncTypographyControls();

    const tableCell = getSelectedTableCell();
    if (tableCell) {
      setSelectedTableCell(tableCell);
    }
    syncTableControls();

    const image = getSelectedImage();
    if (image) {
      setSelectedImage(image);
    }
    syncImageControls();
  }
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (!target.closest(".color-field")) {
    textColor.blur();
    bgColor.blur();
    releaseColorLocks();
  }
});

document.addEventListener("keydown", (event) => {
  const isMod = event.ctrlKey || event.metaKey;
  if (!isMod) {
    return;
  }

  const key = event.key.toLowerCase();

  if (key === "b") {
    event.preventDefault();
    runCommand("bold");
  } else if (key === "i") {
    event.preventDefault();
    runCommand("italic");
  } else if (key === "u") {
    event.preventDefault();
    runCommand("underline");
  } else if (key === "k") {
    event.preventDefault();
    promptAndInsertLink();
  } else if (key === "s") {
    event.preventDefault();
    persist();
  } else if (event.shiftKey && key === "7") {
    event.preventDefault();
    runCommand("insertOrderedList");
  } else if (event.shiftKey && key === "8") {
    event.preventDefault();
    runCommand("insertUnorderedList");
  }
});

const savedContent = localStorage.getItem(STORAGE_KEY);
editor.innerHTML = savedContent && savedContent.trim() ? savedContent : defaultMarkup;
syncOutput();
htmlSource.wrap = "soft";
setSaveStatus(savedContent ? "Loaded from local storage" : "Saved locally", true);
refreshActiveStates();
syncTypographyControls();
syncImageControls();
syncTableControls();
