# semivibe-pdf-editor (react-draw)

Lightweight React + TypeScript PDF annotation canvas built with Vite.

This repository is a small in-browser editor for annotating PDF-like pages (A4) with pen strokes, shapes, text boxes and image attachments. It uses a single HTML5 canvas for rendering strokes and shapes, with DOM overlays for editable text and attachments.

## Quick start (development)

Open a terminal (PowerShell on Windows is recommended) and run:

```powershell
npm install
npm run dev
```

Open the URL shown by Vite (usually http://localhost:5173) in a browser.

Notes:
- If you want to run a TypeScript type-check locally (not required for dev server because Vite does its own checks), run:

```powershell
npx tsc --noEmit
```

## Features
- Pen and highlighter tools
- Shapes (line, rectangle, ellipse, arrow, check, etc.)
- Text boxes (editable DOM overlays)
- Image attachments (drag/drop)
- Zoom in / zoom out / reset
- Page outline overlay (shows the real PDF edges when zoomed out)

## Zoom behavior (important)

- Zoom is applied to the internal viewport and visible canvas size, not by transforming the outer `canvas-area` container. This preserves the logical page size (A4 layout), keeps export calculations stable, and lets scrollbars/panning work naturally.
- Pointer coordinates are converted to logical canvas coordinates by dividing by the current `scale`. That mapping is implemented across drawing, dragging, and text placement.
- A visible page outline has been added so users can easily see the true page edge when zoomed out.

If you need the app to behave differently (for example, to scale the entire `canvas-area` container), be aware that will require changes to pointer mapping, export sizing, and layout — it's more invasive.


## Known issues / TODO
- Linter warnings remain for inline styles used in a few places (small technical debt). These don't break functionality but could be cleaned up.
- Local dev: `npx tsc --noEmit` may fail if TypeScript dev dependency is not installed. Install with `npm install --save-dev typescript` to run it.

## How to test zoom and page edge behavior

1. Start the dev server (see Quick start).
2. Use the toolbar zoom controls to zoom in and out.
3. When zoomed out you should see a light border and a small "PDF page" label at the bottom-right of the page — this is the page outline overlay.
4. Verify you can pan using scroll bars and that drawing, text insertion, and attachments align visually with the canvas content.


## License
MIT
