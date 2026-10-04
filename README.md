# HTML5 Visual Editor

A two-pane HTML editor with source editing, a sandboxed live editor, typography,
image and table controls, local saving, and undo/redo across both editing surfaces.

## Run

Serve this directory over HTTP (JavaScript modules require a web server):

```sh
python3 -m http.server 8765
```

Open **http://localhost:8765**. Any static web host can serve the application;
there is no build step or runtime npm dependency.

The live editor runs in an iframe sandbox without script execution. Authored CSS
is confined to that frame. Copy HTML exports the authored markup, including its
styles, without editor selection markers. This is an editing sandbox, not an HTML
sanitizer for publishing untrusted content elsewhere.

Select text before applying typography. Toolbar edits in HTML source mode accept
text or complete HTML selections, not partial tags or attributes. Repeated style
changes retain the source selection. Undo/redo includes typing, source changes,
formatting, image edits, table changes, and Clear (up to 200 snapshots per session).

## Development checks

With a current Node.js version supported by jsdom (Node 24 recommended):

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

To use an existing Chromium binary:

```sh
CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:browser
```

The browser suite starts its own local HTTP server and checks selection-scoped
formatting, source controls, history, table editing, exported metadata, sandbox
isolation, and storage failures. The core suite covers DOM normalization and
span-aware table transformations.
