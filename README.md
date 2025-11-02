# semivibe-pdf-editor — react-draw

A lightweight in-browser PDF annotation and markup editor built with React, TypeScript and Vite.

This package provides a small, focused canvas-based editor for annotating single-page PDF-like content (default A4 layout) with freehand strokes, highlights, shapes, editable text boxes and image attachments.

Key goals:
- Fast, minimal UI for annotating documents in the browser
- Preserve logical page size for reliable export and printing
- Editable text as DOM overlays for accurate caret placement and accessibility
- Keep interaction code simple and predictable so annotations map precisely to page coordinates

Contents
- `src/` — React app source (canvas rendering, text overlays, toolbar and tools)
- `index.html`, `vite.config.ts` — Vite entry and configuration

Features
- Pen and highlighter with pressure-insensitive stroke rendering
- Shapes (line, rectangle, ellipse, arrow, check, cross, plus/minus)
- Editable text boxes rendered as DOM overlays (contentEditable) for accurate caret handling
- Drag-and-drop image attachments
- Export helpers to embed annotations into PDFs or rasterize pages

Architecture notes
- Rendering: a single HTML5 canvas is used to draw strokes, shapes and raster attachments. Text and attachments are DOM overlays positioned over the canvas to allow selection and editing.
- Zooming: the app applies a visual scale to the internal viewport and visible canvas size while keeping the logical page size fixed; pointer coordinates are mapped back to logical coordinates for interactions.
- Export: when exporting annotated pages, the app either preserves original PDF pages (when available) or rasterizes annotations at a high resolution and overlays them on a target PDF page.

Quick start (development)

1. Install dependencies and run the dev server (PowerShell on Windows recommended):

```powershell
npm install
npm run dev
```

2. Open the URL printed by Vite (usually http://localhost:5173) and interact with the editor.

Type checking (optional):

```powershell
npx tsc --noEmit
```

Configuration & customization
- Page size: the default canvas uses A4 dimensions expressed in CSS units; you can change the page size in the layout CSS or in the canvas sizing logic.
- Zoom: visual zoom is implemented at the viewport level. If you prefer to disable zoom, pass `scale={1}` to the `Canvas` component in `react-draw/src/App.tsx` or hide the toolbar zoom controls.

Testing and known issues
- Manual testing recommended: zoom in/out, pan via scrollbars, draw strokes, add text and attachments, and export to verify fidelity.
- Known: there are lint warnings about inline styles in a few places (small technical debt). There is an intermittent reported case where zoom may appear to reset during certain actions; instrumentation can be added to trace that.

Contributing
- Bug reports and pull requests welcome. For the zoom-reset issue, include a minimal reproduction (sequence of actions) so we can add targeted instrumentation.

License
MIT
