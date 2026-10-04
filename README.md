# HTML5 Visual Editor

A plain HTML/CSS/JavaScript editor with editable source, a sandboxed visual view,
local saving, and undo/redo. No build step, backend, or runtime dependencies.

## Deploy manually to Cloudflare Pages

1. On GitHub, select **Code → Download ZIP**.
2. In Cloudflare, open **Workers & Pages → Create application → Pages → Upload assets**.
3. Upload the downloaded ZIP, enter a project name, and deploy.

The upload root must contain `index.html`. GitHub encloses its files in an
`html5-editor-main/` folder; if Pages retains that outer folder, extract the ZIP
and upload the extracted folder containing `index.html` instead. No repacking,
build commands, npm installation, or separate deployment ZIP is needed.

All four runtime files (`index.html`, `styles.css`, `script.js`, `editor-core.js`)
live at the repository root. Development-only files are excluded from GitHub's
download archive via `.gitattributes`.

## Editing

Select text to format it, or click an image to edit its dimensions, min/max sizes,
padding, margin, alignment, float, border, corner radius, object fit/position,
alternative text, title, and loading behavior. Expand **More image options** for
advanced controls. Size fields accept CSS units, `auto`/`none` where applicable,
and bare numbers as pixels. Clear a field to remove its inline override; text
fields apply on Enter or when leaving the field.

Source-mode formatting accepts text or complete HTML selections. Content is saved
in your browser; use **Copy HTML** to export it. The preview isolates authored CSS
and disables scripts, while export preserves the authored markup.

## Local development (optional)

Serve the repository with `python3 -m http.server 8765`, then open
**http://localhost:8765**. JavaScript modules require HTTP rather than `file://`.

From a Git clone (which includes the development files), run tests with Node.js 24:

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Use `CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:browser` to test with an
existing Chromium binary. Tests serve the root files directly.
