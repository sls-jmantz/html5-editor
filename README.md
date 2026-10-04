# HTML5 Visual Editor

A two-pane HTML editor with editable source and a sandboxed visual preview.

- Typography, colors, links, images, and span-aware table editing.
- Undo/redo across both editing surfaces and automatic local saving.
- Copy HTML without editor selection markers.

## Run

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

## Cloudflare Pages

Connect this repository in **Workers & Pages → Create application → Pages →
Connect to Git** and use:

| Setting | Value |
| --- | --- |
| Project name | `html5-editor` |
| Production branch | `main` |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Repository root |

Node.js 24 is selected by `.node-version`. The build copies only the four runtime
assets into `dist/`; no server, Functions, database, or environment secrets are
required. Pages installs npm dependencies during the build.

For local Pages preview or command-line deployment:

```sh
npm ci
npm run preview       # Local Pages preview at http://localhost:8788
npx wrangler login   # Authenticate once for deployment
npm run deploy       # Build and upload to the html5-editor Pages project
```

For a new Direct Upload project, first run
`npx wrangler pages project create html5-editor --production-branch main` after
logging in. If using a different project name, update `name` in `wrangler.jsonc`.
You can also run `npm run build` and upload the generated `dist/` folder through
the Pages dashboard's Direct Upload flow.

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
