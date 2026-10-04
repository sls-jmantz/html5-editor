# HTML5 Visual Editor

A two-pane HTML editor with editable source and a sandboxed visual preview.

- Typography, colors, links, images, and span-aware table editing.
- Undo/redo across both editing surfaces and automatic local saving.
- Copy HTML without editor selection markers.

## Deploy to Cloudflare Pages (ZIP upload)

1. **[Download html5-editor-pages.zip](https://github.com/sls-jmantz/html5-editor/raw/refs/heads/main/html5-editor-pages.zip)**.
2. In Cloudflare, open **Workers & Pages → Create application → Pages → Upload assets**.
3. Enter a project name, upload the ZIP, and click **Deploy site**.

The ZIP is ready to deploy: no Git connection, build command, npm installation,
or environment variables are needed. It contains `index.html`, `styles.css`,
`script.js`, and `editor-core.js` at the archive root. Use this deployment ZIP,
not GitHub's **Code → Download ZIP** source archive.

After changing the editor, regenerate the deployment ZIP with:

```sh
npm ci
npm run package
```

## Run locally

Serve this directory over HTTP; JavaScript modules require a web server:

```sh
python3 -m http.server 8765
```

Open **http://localhost:8765**. No build step or runtime npm dependencies are needed.

Select text before applying typography. In source mode, select text or complete
HTML rather than partial tags or attributes. Content stays in your browser's
local storage; use **Copy HTML** to export it.

The preview isolates authored CSS and disables scripts. Export preserves authored
markup; the editing sandbox does not sanitize exported HTML.

## Development checks

With Node.js 24 or another version supported by jsdom:

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

The browser tests build and serve the deployment assets in `dist/`. To use an installed Chromium, set
`CHROMIUM_EXECUTABLE=/path/to/chromium` when running `npm run test:browser`.
