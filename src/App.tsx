import { useMemo, useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import type { ChangeEvent } from 'react';
import { PDFDocument } from 'pdf-lib';
import clsx from 'clsx';
import Canvas from './Canvas';
import ColorPicker from './ColorPicker';
import type { Page, Shape, ShapeType, Stroke, TextItem, ToolType, AttachItem } from './types';

type PdfImport = {
  id: string;
  name: string;
  pageIds: string[];
  // keep original PDF bytes so we can later embed pages losslessly during export
  data?: Uint8Array;
};

type TextDefaults = {
  color: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: CanvasTextAlign;
  width: number;
  background: boolean;
  backgroundColor: string;
};

const PEN_COLORS = [
  '#0f172a', // near-black
  '#1f2937', // dark gray
  '#1d4ed8', // blue
  '#0ea5e9', // cyan
  '#06b6d4', // teal
  '#059669', // green
  '#10b981', // emerald
  '#f97316', // orange
  '#fb7185', // pink
  '#ef4444', // red
  '#7c3aed'  // purple
];
const HIGHLIGHT_COLORS = [
  '#fde047', // yellow
  '#fef3c7', // pale yellow
  '#38bdf8', // light blue
  '#7dd3fc', // sky
  '#34d399', // mint
  '#86efac', // light mint
  '#fca5a5', // light pink
  '#c084fc', // violet
  '#fbbf24'  // amber
];
const HIGHLIGHT_OPACITIES = [
  { label: 'Light', value: 0.35 },
  { label: 'Medium', value: 0.55 },
  { label: 'Bold', value: 0.75 }
];
const TEXT_COLORS = ['#0f172a', '#1d4ed8', '#dc2626', '#16a34a', '#0ea5e9', '#f97316'];
const TEXT_BG_COLORS = ['#ffffff', '#fef3c7', '#fee2e2', '#dbeafe', '#dcfce7', '#f8fafc'];
const SHAPE_TYPES: Array<{ id: ShapeType; label: string }> = [
  { id: 'line', label: 'Line' },
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'ellipse', label: 'Circle' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'check', label: 'Check' },
  { id: 'cross', label: 'Cross' },
  { id: 'plus', label: '+' },
  { id: 'minus', label: '−' },
  { id: 'times', label: '×' },
  { id: 'divide', label: '÷' }
];

const defaultText: TextDefaults = {
  color: '#0f172a',
  fontSize: 20,
  fontFamily: 'Inter, system-ui, sans-serif',
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
  width: 240,
  background: true,
  backgroundColor: '#ffffff'
};

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const createPage = (index: number): Page => ({
  id: createId(),
  name: `Page ${index + 1}`,
  strokes: [],
  shapes: [],
  texts: [],
  attachments: []
});

const createText = (x: number, y: number, defaults: TextDefaults): TextItem => ({
  id: createId(),
  x,
  y,
  width: defaults.width,
  text: '',
  color: defaults.color,
  fontSize: defaults.fontSize,
  fontFamily: defaults.fontFamily,
  bold: defaults.bold,
  italic: defaults.italic,
  underline: defaults.underline,
  align: defaults.align,
  background: defaults.background,
  backgroundColor: defaults.backgroundColor
  ,
  singleLine: false
});

let cachedPdfWorkerSrc: string | null = null;
let pdfWorkerSrcPromise: Promise<string> | null = null;
const getPdfWorkerSrc = async (): Promise<string> => {
  if (cachedPdfWorkerSrc) return cachedPdfWorkerSrc;
  if (!pdfWorkerSrcPromise) {
    pdfWorkerSrcPromise = (async () => {
      const mod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      const src = (mod as { default?: string }).default ?? (mod as unknown as string);
      if (typeof src !== 'string' || !src) {
        throw new Error('Unable to resolve pdf.js worker url.');
      }
      if (typeof window !== 'undefined') {
        (window as any).__PDF_WORKER_URL = src;
      }
      cachedPdfWorkerSrc = src;
      return src;
    })();
  }
  return pdfWorkerSrcPromise;
};

const TOOL_META: Array<{ id: ToolType; label: string; hint: string }> = [
  { id: 'pointer', label: 'Pointer', hint: 'Pointer tool (Esc)' },
  { id: 'pen', label: 'Pen', hint: 'Pen tool (P)' },
  { id: 'highlighter', label: 'Highlight', hint: 'Highlighter (H)' },
  { id: 'shape', label: 'Shapes', hint: 'Shapes (S)' },
  { id: 'text', label: 'Text', hint: 'Text tool (T)' },
  { id: 'attach', label: 'Attach', hint: 'Attach (A)' },
  { id: 'eraser', label: 'Eraser', hint: 'Eraser (E)' }
];

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

const App = () => {
  const firstPage = useMemo(() => createPage(0), []);
  const [pages, setPages] = useState<Page[]>([firstPage]);
  const [showPalette, setShowPalette] = useState(false);
  const [activePageId, setActivePageId] = useState(firstPage.id);
  const [tool, setTool] = useState<ToolType>('pointer');
  const [penColor, setPenColor] = useState('#1d4ed8');
  const [penWidth, setPenWidth] = useState(4);
  const [highlightColor, setHighlightColor] = useState('#fde047');
  const [highlightWidth, setHighlightWidth] = useState(18);
  // customizable color palettes (start with defaults, allow adding new colors)
  const [penColors, setPenColors] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('penColors');
      return raw ? JSON.parse(raw) : PEN_COLORS.slice();
    } catch (e) {
      return PEN_COLORS.slice();
    }
  });
  const [highlightColors, setHighlightColors] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('highlightColors');
      return raw ? JSON.parse(raw) : HIGHLIGHT_COLORS.slice();
    } catch (e) {
      return HIGHLIGHT_COLORS.slice();
    }
  });
  const [newColor, setNewColor] = useState('#000000');
  const [showInlinePicker, setShowInlinePicker] = useState(false);
  const [showShapePicker, setShowShapePicker] = useState(false);
  const [showTextBgPicker, setShowTextBgPicker] = useState(false);
  const inlinePickerRef = useRef<HTMLDivElement | null>(null);
  const shapePickerRef = useRef<HTMLDivElement | null>(null);
  const textBgPickerRef = useRef<HTMLDivElement | null>(null);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const textColorPickerRef = useRef<HTMLDivElement | null>(null);

  // close popovers when clicking outside or pressing Escape
  useEffect(() => {
    if (!showInlinePicker && !showShapePicker && !showPalette && !showTextBgPicker && !showTextColorPicker) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (inlinePickerRef.current && inlinePickerRef.current.contains(t)) return;
      if (shapePickerRef.current && shapePickerRef.current.contains(t)) return;
      if (textBgPickerRef.current && textBgPickerRef.current.contains(t)) return;
      if (textColorPickerRef.current && textColorPickerRef.current.contains(t)) return;
      if (toolbarRef.current && toolbarRef.current.contains(t)) return;
      setShowInlinePicker(false);
      setShowShapePicker(false);
      setShowTextBgPicker(false);
      setShowTextColorPicker(false);
      setShowPalette(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowInlinePicker(false);
        setShowShapePicker(false);
        setShowTextBgPicker(false);
        setShowTextColorPicker(false);
        setShowPalette(false);
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [showInlinePicker, showShapePicker, showPalette, showTextBgPicker, showTextColorPicker]);
  const addColor = (c: string) => {
    if (!c) return;
    if (tool === 'highlighter') {
      setHighlightColors((prev) => {
        const next = [c, ...prev.filter((p) => p !== c)];
        try {
          localStorage.setItem('highlightColors', JSON.stringify(next));
        } catch (e) {}
        return next;
      });
      setHighlightColor(c);
    } else {
      setPenColors((prev) => {
        const next = [c, ...prev.filter((p) => p !== c)];
        try {
          localStorage.setItem('penColors', JSON.stringify(next));
        } catch (e) {}
        return next;
      });
      setPenColor(c);
    }
  };
  // add color explicitly to a specific palette (pen or highlighter)
  const addColorTo = (c: string, target: 'pen' | 'highlighter') => {
    if (!c) return;
    if (target === 'highlighter') {
      setHighlightColors((prev) => {
        const next = [c, ...prev.filter((p) => p !== c)];
        try {
          localStorage.setItem('highlightColors', JSON.stringify(next));
        } catch (e) {}
        return next;
      });
      setHighlightColor(c);
    } else {
      setPenColors((prev) => {
        const next = [c, ...prev.filter((p) => p !== c)];
        try {
          localStorage.setItem('penColors', JSON.stringify(next));
        } catch (e) {}
        return next;
      });
      setPenColor(c);
    }
  };
  const resetPalettes = () => {
    try {
      localStorage.removeItem('penColors');
      localStorage.removeItem('highlightColors');
    } catch (e) {}
    setPenColors(PEN_COLORS.slice());
    setHighlightColors(HIGHLIGHT_COLORS.slice());
  };
  const [highlightOpacity, setHighlightOpacity] = useState(0.55);
  const [shapeType, setShapeType] = useState<ShapeType>('rectangle');
  const [shapeColor, setShapeColor] = useState('#1d4ed8');
  const [shapeWidth, setShapeWidth] = useState(3);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedAttachId, setSelectedAttachId] = useState<string | null>(null);
  const [textDefaults, setTextDefaults] = useState<TextDefaults>(defaultText);
  const [eraserWidth, setEraserWidth] = useState(24);
  const [uploadedAssets, setUploadedAssets] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const [pdfImports, setPdfImports] = useState<PdfImport[]>([]);
  const toolbarRef = useRef<HTMLElement | null>(null);
  // PDF import progress / worker status
  const [importingPdf, setImportingPdf] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [workerStatus, setWorkerStatus] = useState<'available' | 'disabled' | 'failed' | 'unknown'>('unknown');
  // zoom (scale) for the workspace canvas
  const [zoom, setZoom] = useState<number>(1);
  const updateZoom = useCallback(
    (next: number | ((prev: number) => number), anchor?: { x: number; y: number }) => {
      setZoom((prevZoom) => {
        const current = prevZoom || 1;
        const rawTarget = typeof next === 'function' ? next(current) : next;
        const numericTarget = typeof rawTarget === 'number' && Number.isFinite(rawTarget) ? rawTarget : current;
        const target = clampZoom(numericTarget);
        if (Math.abs(target - current) < 0.001) return current;
        const container = document.querySelector('.canvas-area') as HTMLElement | null;
        if (container) {
          const rect = container.getBoundingClientRect();
          const anchorX = anchor?.x ?? rect.left + rect.width / 2;
          const anchorY = anchor?.y ?? rect.top + rect.height / 2;
          const offsetX = anchorX - rect.left;
          const offsetY = anchorY - rect.top;
          const contentX = (offsetX + container.scrollLeft) / current;
          const contentY = (offsetY + container.scrollTop) / current;
          requestAnimationFrame(() => {
            container.scrollLeft = Math.max(0, Math.round(contentX * target - offsetX));
            container.scrollTop = Math.max(0, Math.round(contentY * target - offsetY));
          });
        }
        return target;
      });
    },
    []
  );
  const handleZoomIn = useCallback(() => {
    updateZoom((prev) => prev * 1.2);
  }, [updateZoom]);
  const handleZoomOut = useCallback(() => {
    updateZoom((prev) => prev / 1.2);
  }, [updateZoom]);
  const handleZoomReset = useCallback(() => {
    updateZoom(1);
  }, [updateZoom]);
  const handleZoomSliderChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) {
      updateZoom(value);
    }
  }, [updateZoom]);
  const zoomPercent = Math.round(zoom * 100);
  const isZoomAtMin = zoom <= ZOOM_MIN + 0.001;
  const isZoomAtMax = zoom >= ZOOM_MAX - 0.001;

  // Improve zoom UX: support Ctrl/Cmd + mouse wheel to zoom centered at the cursor
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      try {
        if (!(e.ctrlKey || e.metaKey)) return;
        const container = document.querySelector('.canvas-area') as HTMLElement | null;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        // ignore wheel events outside the canvas area
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
        e.preventDefault();
        const delta = -e.deltaY;
        const factor = delta > 0 ? 1.12 : 0.88;
        updateZoom((prev) => prev * factor, { x: e.clientX, y: e.clientY });
      } catch (err) {
        // ignore
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel as EventListener);
  }, [updateZoom]);

  // load project-scoped assets from src/assets at build time (Vite import.meta.glob)
  useEffect(() => {
    // This uses Vite's import.meta.glob to bundle image URLs from src/assets.
    // It runs at build/dev time and returns a map of path->url when eager: true.
    try {
      // @ts-ignore - import.meta.glob types are provided by Vite; ignore TS in plain tsc runs
      const modules = import.meta.glob('/src/assets/*.{png,jpg,jpeg,webp,gif,svg}', { as: 'url', eager: true });
      const entries = Object.entries(modules) as Array<[string, string]>;
      if (entries.length > 0) {
        const next = entries.map(([path, url]) => ({ id: createId(), name: path.split('/').pop() ?? path, url }));
        setUploadedAssets((prev) => [...next, ...prev]);
      }
    } catch (e) {
      // import.meta.glob not available in non-vite environments; ignore silently
    }
  }, []);

  // measure toolbar and set CSS variable so workspace is offset dynamically
  useLayoutEffect(() => {
    const setOffset = () => {
      try {
        const el = toolbarRef.current;
        if (!el) return;
        const h = Math.ceil(el.getBoundingClientRect().height + 12); // 12px gap
        document.documentElement.style.setProperty('--toolbar-offset', `${h}px`);
      } catch (e) {
        // ignore
      }
    };
    setOffset();
    window.addEventListener('resize', setOffset);
    return () => window.removeEventListener('resize', setOffset);
  }, []);

  const handleExportPdf = useCallback(async () => {
    try {
      const a4mm = { w: 210, h: 297 };
      const DPI = 300;
      const mmToInch = (mm: number) => mm / 25.4;
      const targetW = Math.round(mmToInch(a4mm.w) * DPI);
      const targetH = Math.round(mmToInch(a4mm.h) * DPI);

      const container = document.querySelector('.canvas-area') as HTMLElement | null;
      const srcWidth = container ? container.getBoundingClientRect().width :  (210);
      const srcHeight = container ? container.getBoundingClientRect().height : (297);
      const scaleX = targetW / srcWidth;
      const scaleY = targetH / srcHeight;

      const loadImage = (src: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = (e) => reject(e);
          img.src = src;
        });

      const pdfDoc = await PDFDocument.create();

      // We'll preserve original PDF pages (lossless) when possible: if a page was imported
      // from a PDF and has no user annotations (strokes/shapes/texts/extra attachments) then
      // copy the page from the original PDF into the export. Otherwise fall back to rasterizing
      // the rendered page at high resolution (A4 @ DPI) to preserve visual fidelity.
      const importDocCache = new Map<string, any>();
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const pageModel = pages[pageIndex];
        const imp = pageModel.pdfImportGroup ? pdfImports.find((it) => it.id === pageModel.pdfImportGroup) : undefined;
        const isPureImportedPage = !!(
          imp &&
          imp.data &&
          (pageModel.strokes?.length ?? 0) === 0 &&
          (pageModel.shapes?.length ?? 0) === 0 &&
          (pageModel.texts?.length ?? 0) === 0 &&
          (pageModel.attachments ?? []).every((a) => a.pdfBackgroundGroup === pageModel.pdfImportGroup)
        );

        if (imp && imp.data) {
          // load source PDF once per import
          let srcPdf: any = importDocCache.get(imp.id);
          if (!srcPdf) {
            srcPdf = await PDFDocument.load(imp.data as Uint8Array);
            importDocCache.set(imp.id, srcPdf);
          }
          const srcPageIndex = imp.pageIds.indexOf(pageModel.id);
          if (srcPageIndex >= 0) {
            const [copied] = await pdfDoc.copyPages(srcPdf, [srcPageIndex]);
            // add copied page to target doc (preserves vector content)
            const added = pdfDoc.addPage(copied as any);

            // Determine if this page has any user annotations (strokes/shapes/texts or non-background attachments)
            const hasAnnotations = (
              (pageModel.strokes?.length ?? 0) > 0 ||
              (pageModel.shapes?.length ?? 0) > 0 ||
              (pageModel.texts?.length ?? 0) > 0 ||
              (pageModel.attachments ?? []).some((a) => a.pdfBackgroundGroup !== pageModel.pdfImportGroup)
            );

            if (!hasAnnotations) {
              // nothing to overlay; the copied page is sufficient (vector preserved)
              continue;
            }

            // If there are annotations, render only the annotations to a high-res PNG and overlay
            const offOverlay = document.createElement('canvas');
            offOverlay.width = targetW;
            offOverlay.height = targetH;
            const ctxO = offOverlay.getContext('2d');
            if (!ctxO) throw new Error('Unable to create overlay canvas');
            ctxO.clearRect(0, 0, offOverlay.width, offOverlay.height);

            // compute scale from app CSS width to overlay pixels
            const containerEl = document.querySelector('.canvas-area') as HTMLElement | null;
            const appWidth = containerEl ? containerEl.getBoundingClientRect().width : 210;
            const scaleXov = targetW / appWidth;
            const scaleYov = targetH / (containerEl ? containerEl.getBoundingClientRect().height : 297);

            // draw non-background attachments (user-added images)
            for (const attach of (pageModel.attachments ?? []).filter((a) => a.pdfBackgroundGroup !== pageModel.pdfImportGroup)) {
              try {
                const img = await loadImage(attach.src);
                ctxO.drawImage(
                  img,
                  attach.x * scaleXov,
                  attach.y * scaleYov,
                  attach.width * scaleXov,
                  attach.height * scaleYov
                );
              } catch (e) {}
            }

            // draw shapes (overlay path)
            const drawShapeOverlay = (shape: Shape) => {
              ctxO.save();
              ctxO.strokeStyle = shape.stroke;
              ctxO.lineWidth = (shape.strokeWidth || 1) * Math.max(scaleXov, scaleYov);
              ctxO.lineJoin = 'round';
              ctxO.lineCap = 'round';
              const sx = shape.start.x * scaleXov;
              const sy = shape.start.y * scaleYov;
              const ex = shape.end.x * scaleXov;
              const ey = shape.end.y * scaleYov;
              switch (shape.type) {
                case 'line':
                  ctxO.beginPath();
                  ctxO.moveTo(sx, sy);
                  ctxO.lineTo(ex, ey);
                  ctxO.stroke();
                  break;
                case 'arrow': {
                  const angle = Math.atan2(ey - sy, ex - sx);
                  const headLength = 12 + (shape.strokeWidth || 1) * 1.5;
                  ctxO.beginPath();
                  ctxO.moveTo(sx, sy);
                  ctxO.lineTo(ex, ey);
                  ctxO.stroke();
                  ctxO.beginPath();
                  ctxO.moveTo(ex, ey);
                  ctxO.lineTo(
                    ex - headLength * Math.cos(angle - Math.PI / 6),
                    ey - headLength * Math.sin(angle - Math.PI / 6)
                  );
                  ctxO.moveTo(ex, ey);
                  ctxO.lineTo(
                    ex - headLength * Math.cos(angle + Math.PI / 6),
                    ey - headLength * Math.sin(angle + Math.PI / 6)
                  );
                  ctxO.stroke();
                  break;
                }
                case 'rectangle': {
                  const left = Math.min(sx, ex);
                  const top = Math.min(sy, ey);
                  const width = Math.abs(ex - sx);
                  const height = Math.abs(ey - sy);
                  ctxO.strokeRect(left, top, width, height);
                  break;
                }
                case 'ellipse': {
                  const rx = Math.max(Math.abs(ex - sx) / 2, 1);
                  const ry = Math.max(Math.abs(ey - sy) / 2, 1);
                  const cx = (sx + ex) / 2;
                  const cy = (sy + ey) / 2;
                  ctxO.beginPath();
                  ctxO.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                  ctxO.stroke();
                  break;
                }
                default:
                  break;
              }
              ctxO.restore();
            };

            // draw texts
            for (const text of pageModel.texts) {
              const fontSize = text.fontSize * Math.max(scaleXov, scaleYov);
              ctxO.font = `${text.bold ? '700' : '400'} ${fontSize}px ${text.fontFamily}`;
              ctxO.fillStyle = text.color || '#000';
              const lineHeight = fontSize * 1.2;
              const maxWidth = text.width * scaleXov;
              const x = text.x * scaleXov;
              let y = text.y * scaleYov + fontSize;
              if (text.background) {
                const lines: string[] = [];
                if (text.singleLine) lines.push(text.text);
                else {
                  const words = (text.text || '').split(/\s+/);
                  let line = '';
                  for (const w of words) {
                    const test = line ? line + ' ' + w : w;
                    const m = ctxO.measureText(test).width;
                    if (m > maxWidth && line) {
                      lines.push(line);
                      line = w;
                    } else {
                      line = test;
                    }
                  }
                  if (line) lines.push(line);
                }
                const bgH = lines.length * lineHeight + 8;
                ctxO.fillStyle = text.backgroundColor || '#fff';
                ctxO.fillRect(x - 4, text.y * scaleYov - 4, maxWidth + 8, bgH);
                ctxO.fillStyle = text.color || '#000';
                for (const l of lines) {
                  ctxO.fillText(l, x, y);
                  y += lineHeight;
                }
              } else {
                if (text.singleLine) {
                  ctxO.fillText(text.text || '', x, y);
                } else {
                  const words = (text.text || '').split(/\s+/);
                  let line = '';
                  for (const w of words) {
                    const test = line ? line + ' ' + w : w;
                    const m = ctxO.measureText(test).width;
                    if (m > maxWidth && line) {
                      ctxO.fillText(line, x, y);
                      line = w;
                      y += lineHeight;
                    } else {
                      line = test;
                    }
                  }
                  if (line) ctxO.fillText(line, x, y);
                }
              }
            }

            const overlayBlob: Blob | null = await new Promise((resolve) => offOverlay.toBlob((b) => resolve(b), 'image/png'));
            if (overlayBlob) {
              const overlayArray = await overlayBlob.arrayBuffer();
              const overlayImg = await pdfDoc.embedPng(overlayArray);
              const ptPerInch = 72;
              const a4pt = { w: Math.round(mmToInch(a4mm.w) * ptPerInch), h: Math.round(mmToInch(a4mm.h) * ptPerInch) };
              added.drawImage(overlayImg, { x: 0, y: 0, width: a4pt.w, height: a4pt.h });
            }

            continue;
          }
        }

        // Fallback: rasterize the whole page at A4 @ DPI (preserves visual look for annotated pages)
        const off = document.createElement('canvas');
        off.width = targetW;
        off.height = targetH;
        const ctx = off.getContext('2d');
        if (!ctx) throw new Error('Unable to create export canvas');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, off.width, off.height);

        // draw attachments, shapes, strokes and text scaled to the target A4 canvas
        const container = document.querySelector('.canvas-area') as HTMLElement | null;
        const srcWidth = container ? container.getBoundingClientRect().width : 210;
        const srcHeight = container ? container.getBoundingClientRect().height : 297;
        const scaleX = targetW / srcWidth;
        const scaleY = targetH / srcHeight;

        for (const attach of pageModel.attachments ?? []) {
          try {
            const img = await loadImage(attach.src);
            ctx.drawImage(
              img,
              attach.x * scaleX,
              attach.y * scaleY,
              attach.width * scaleX,
              attach.height * scaleY
            );
          } catch (e) {}
        }

        const drawShape = (shape: Shape) => {
          ctx.save();
          ctx.strokeStyle = shape.stroke;
          ctx.lineWidth = (shape.strokeWidth || 1) * Math.max(scaleX, scaleY);
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          const sx = shape.start.x * scaleX;
          const sy = shape.start.y * scaleY;
          const ex = shape.end.x * scaleX;
          const ey = shape.end.y * scaleY;
          switch (shape.type) {
            case 'line':
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.lineTo(ex, ey);
              ctx.stroke();
              break;
            case 'arrow': {
              const angle = Math.atan2(ey - sy, ex - sx);
              const headLength = 12 + (shape.strokeWidth || 1) * 1.5;
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.lineTo(ex, ey);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(ex, ey);
              ctx.lineTo(
                ex - headLength * Math.cos(angle - Math.PI / 6),
                ey - headLength * Math.sin(angle - Math.PI / 6)
              );
              ctx.moveTo(ex, ey);
              ctx.lineTo(
                ex - headLength * Math.cos(angle + Math.PI / 6),
                ey - headLength * Math.sin(angle + Math.PI / 6)
              );
              ctx.stroke();
              break;
            }
            case 'rectangle': {
              const left = Math.min(sx, ex);
              const top = Math.min(sy, ey);
              const width = Math.abs(ex - sx);
              const height = Math.abs(ey - sy);
              ctx.strokeRect(left, top, width, height);
              break;
            }
            case 'ellipse': {
              const rx = Math.max(Math.abs(ex - sx) / 2, 1);
              const ry = Math.max(Math.abs(ey - sy) / 2, 1);
              const cx = (sx + ex) / 2;
              const cy = (sy + ey) / 2;
              ctx.beginPath();
              ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
              ctx.stroke();
              break;
            }
            default:
              break;
          }
          ctx.restore();
        };

        for (const shape of pageModel.shapes) drawShape(shape);

        for (const stroke of pageModel.strokes) {
          if (!stroke.points || stroke.points.length < 2) continue;
          ctx.save();
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.lineWidth = (stroke.thickness || 1) * Math.max(scaleX, scaleY);
          ctx.strokeStyle = stroke.color;
          ctx.globalAlpha = stroke.tool === 'highlighter' ? stroke.opacity ?? 0.55 : 1;
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x * scaleX, stroke.points[0].y * scaleY);
          for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x * scaleX, stroke.points[i].y * scaleY);
          }
          ctx.stroke();
          ctx.restore();
        }

        for (const text of pageModel.texts) {
          const fontSize = text.fontSize * Math.max(scaleX, scaleY);
          ctx.font = `${text.bold ? '700' : '400'} ${fontSize}px ${text.fontFamily}`;
          ctx.fillStyle = text.color || '#000';
          const lineHeight = fontSize * 1.2;
          const maxWidth = text.width * scaleX;
          const x = text.x * scaleX;
          let y = text.y * scaleY + fontSize;
          if (text.background) {
            const lines: string[] = [];
            if (text.singleLine) lines.push(text.text);
            else {
              const words = (text.text || '').split(/\s+/);
              let line = '';
              for (const w of words) {
                const test = line ? line + ' ' + w : w;
                const m = ctx.measureText(test).width;
                if (m > maxWidth && line) {
                  lines.push(line);
                  line = w;
                } else {
                  line = test;
                }
              }
              if (line) lines.push(line);
            }
            const bgH = lines.length * lineHeight + 8;
            ctx.fillStyle = text.backgroundColor || '#fff';
            ctx.fillRect(x - 4, text.y * scaleY - 4, maxWidth + 8, bgH);
            ctx.fillStyle = text.color || '#000';
            for (const l of lines) {
              ctx.fillText(l, x, y);
              y += lineHeight;
            }
          } else {
            if (text.singleLine) {
              ctx.fillText(text.text || '', x, y);
            } else {
              const words = (text.text || '').split(/\s+/);
              let line = '';
              for (const w of words) {
                const test = line ? line + ' ' + w : w;
                const m = ctx.measureText(test).width;
                if (m > maxWidth && line) {
                  ctx.fillText(line, x, y);
                  line = w;
                  y += lineHeight;
                } else {
                  line = test;
                }
              }
              if (line) ctx.fillText(line, x, y);
            }
          }
        }

        const blob: Blob | null = await new Promise((resolve) => off.toBlob((b) => resolve(b), 'image/png'));
        if (!blob) throw new Error('Failed to render page image');
        const arrayBuffer = await blob.arrayBuffer();
        const img = await pdfDoc.embedPng(arrayBuffer);
        const ptPerInch = 72;
        const a4pt = { w: Math.round(mmToInch(a4mm.w) * ptPerInch), h: Math.round(mmToInch(a4mm.h) * ptPerInch) };
        const page = pdfDoc.addPage([a4pt.w, a4pt.h]);
        page.drawImage(img, { x: 0, y: 0, width: a4pt.w, height: a4pt.h });
      }

      const pdfBytes = await pdfDoc.save();
  // pdfBytes is a Uint8Array; cast to any so Blob typing is satisfied across environments
  const pdfBlob = new Blob([pdfBytes as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'export.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + (err as Error).message);
    }
  }, [pages]);

  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];

  // HISTORY (undo / redo)
  const applyingHistoryRef = useRef(false);
  const mountedRef = useRef(false);

  // store history in refs to avoid expensive rerenders; use a small state to force update when index changes
  const MAX_HISTORY = 100;
  const historyRef = useRef<{ pages: Page[]; activePageId: string }[]>([{ pages, activePageId }]);
  const historyIndexRef = useRef(0);
  const [, setHistoryVersion] = useState(0);

  const pushHistory = useCallback((pagesSnapshot: Page[], activeId: string) => {
    if (applyingHistoryRef.current) return;
    const cut = historyRef.current.slice(0, historyIndexRef.current + 1);
    const next = [...cut, { pages: pagesSnapshot, activePageId: activeId }];
    // cap history length by dropping oldest entries
    if (next.length > MAX_HISTORY) {
      // remove the oldest entries so remaining length === MAX_HISTORY
      next.splice(0, next.length - MAX_HISTORY);
    }
    historyRef.current = next;
    historyIndexRef.current = historyRef.current.length - 1;
    setHistoryVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    pushHistory(pages, activePageId);
  }, [pages, activePageId, pushHistory]);

  const canUndo = () => historyIndexRef.current > 0;
  const canRedo = () => historyIndexRef.current < historyRef.current.length - 1;

  const undo = useCallback(() => {
    if (!canUndo()) return;
    const newIdx = historyIndexRef.current - 1;
    const snap = historyRef.current[newIdx];
    applyingHistoryRef.current = true;
    setPages(snap.pages);
    setActivePageId(snap.activePageId);
    historyIndexRef.current = newIdx;
    setHistoryVersion((v) => v + 1);
    setTimeout(() => {
      applyingHistoryRef.current = false;
    }, 0);
  }, []);

  const redo = useCallback(() => {
    if (!canRedo()) return;
    const newIdx = historyIndexRef.current + 1;
    const snap = historyRef.current[newIdx];
    applyingHistoryRef.current = true;
    setPages(snap.pages);
    setActivePageId(snap.activePageId);
    historyIndexRef.current = newIdx;
    setHistoryVersion((v) => v + 1);
    setTimeout(() => {
      applyingHistoryRef.current = false;
    }, 0);
  }, []);

  // keyboard shortcuts: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Y or Ctrl+Shift+Z (redo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        e.preventDefault();
      } else if (e.key.toLowerCase() === 'y') {
        redo();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
  // END HISTORY

  const updateActivePage = (fn: (page: Page) => Page) => {
    setPages((prev) => {
      const newPages = prev.map((page) => (page.id === activePageId ? fn(page) : page));
      // push snapshot after computing newPages
      pushHistory(newPages, activePageId);
      return newPages;
    });
  };

  const handleEraseStroke = (id: string) => {
    updateActivePage((page) => ({ ...page, strokes: page.strokes.filter((s) => s.id !== id) }));
  };

  const handleEraseShape = (id: string) => {
    updateActivePage((page) => ({ ...page, shapes: page.shapes.filter((s) => s.id !== id) }));
  };

  const handleStrokeEnd = (stroke: Stroke) => {
    updateActivePage((page) => ({
      ...page,
      strokes: [...page.strokes, stroke]
    }));
  };

  const handleShapeComplete = (shape: Shape) => {
    updateActivePage((page) => ({
      ...page,
      shapes: [...page.shapes, shape]
    }));
  };

  const handleTextChange = (id: string, changes: Partial<TextItem>) => {
    updateActivePage((page) => ({
      ...page,
      texts: page.texts.map((text) => (text.id === id ? { ...text, ...changes } : text))
    }));
    if (selectedTextId === id) {
      setTextDefaults((prev) => ({
        ...prev,
        ...(changes.color !== undefined ? { color: changes.color } : {}),
        ...(changes.fontSize !== undefined ? { fontSize: changes.fontSize } : {}),
        ...(changes.fontFamily !== undefined ? { fontFamily: changes.fontFamily } : {}),
        ...(changes.bold !== undefined ? { bold: changes.bold } : {}),
        ...(changes.italic !== undefined ? { italic: changes.italic } : {}),
        ...(changes.underline !== undefined ? { underline: changes.underline } : {}),
        ...(changes.align !== undefined ? { align: changes.align } : {}),
        ...(changes.width !== undefined ? { width: changes.width } : {}),
        ...(changes.background !== undefined ? { background: changes.background } : {}),
        ...(changes.backgroundColor !== undefined ? { backgroundColor: changes.backgroundColor } : {})
      }));
    }
  };

  // create text, optionally with initial content (used for drop)
  const handleTextCreate = (x: number, y: number, initialText?: string, clientX?: number, clientY?: number) => {
    // Compute padding from rem units defined in CSS so the click aligns with the
    // contentEditable text area (the .text-box has padding: 0.6rem 0.9rem).
    let padLeft = 14; // default px fallback (~0.9rem @16px)
    let padTop = 10; // default px fallback (~0.6rem @16px)
    try {
      const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
      padLeft = rootFont * 0.9;
      padTop = rootFont * 0.6;
    } catch (e) {
      // ignore and use defaults
    }

    // Position the box so that the inner content's left edge (after padding) is at the click X.
    // Also adjust Y so the click hits near the first text line (account for padding and a small baseline shift).
    const safeX = Math.max(8, Math.round(x - padLeft));
    const safeY = Math.max(8, Math.round(y - padTop - (textDefaults.fontSize * 0.3)));
    const text = createText(safeX, safeY, textDefaults);
    if (initialText) text.text = initialText;
    if (typeof clientX === 'number') (text as any).initialClientX = clientX;
    if (typeof clientY === 'number') (text as any).initialClientY = clientY;
    updateActivePage((page) => ({
      ...page,
      texts: [...page.texts, text]
    }));
    setSelectedTextId(text.id);
    setTool('text');
  };

  // NOTE: removed auto-create/nudge behavior so text placement is manual (user clicks to place).

  const handleTextDelete = (id: string) => {
    updateActivePage((page) => ({
      ...page,
      texts: page.texts.filter((text) => text.id !== id)
    }));
    if (selectedTextId === id) {
      setSelectedTextId(null);
    }
  };

  // asset upload / palette
  const handleFilesAdded = (files: FileList | null) => {
    if (!files) return;
    const next: Array<{ id: string; name: string; url: string }> = [];
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      if (!f.type.startsWith('image/')) continue;
      const url = URL.createObjectURL(f);
      next.push({ id: createId(), name: f.name, url });
      objectUrlsRef.current.add(url);
    }
    if (next.length > 0) setUploadedAssets((prev) => [...prev, ...next]);
  };

  // Import PDF and render pages to background attachments (uses pdfjs)
  const handlePdfUpload = async (file: File) => {
    try {
      setImportingPdf(true);
      setImportProgress({ current: 0, total: 0 });
      setWorkerStatus((typeof window !== 'undefined' && (window as any).__PDF_WORKER_URL) ? 'available' : 'unknown');

      const arrayBuffer = await file.arrayBuffer();
      // Make an explicit copy of the PDF bytes immediately so that if pdf.js
      // transfers the original ArrayBuffer to a worker (detaching it), we still
      // have an independent copy to use for lossless export/copyPages.
      const originalBytes = new Uint8Array(arrayBuffer).slice();
      const pdfjs = await import('pdfjs-dist');
      if (!pdfjs) throw new Error('Unable to load pdfjs-dist module.');
      const getDocument = pdfjs.getDocument || pdfjs.default?.getDocument;
      const GlobalWorkerOptions = pdfjs.GlobalWorkerOptions || pdfjs.default?.GlobalWorkerOptions;
      if (!getDocument) throw new Error('pdfjs-dist getDocument API not available.');
      if (!GlobalWorkerOptions) throw new Error('pdfjs-dist GlobalWorkerOptions API not available.');

      let workerReady = false;
      try {
        if (!GlobalWorkerOptions.workerSrc || GlobalWorkerOptions.workerSrc === './pdf.worker.mjs') {
          const workerSrc = await getPdfWorkerSrc();
          GlobalWorkerOptions.workerSrc = workerSrc;
        }
        workerReady = true;
      } catch (workerErr) {
        console.warn('Failed to configure pdf.js worker', workerErr);
      }
      setWorkerStatus(workerReady ? 'available' : 'failed');
      if (!workerReady) {
        throw new Error('Unable to configure pdf.js worker bundle.');
      }

      const loading = getDocument({ data: arrayBuffer } as any);
      const pdf = await loading.promise;
      const groupId = createId();
      const pageIds: string[] = [];
      // clone current pages to mutate locally
      const localPages = pages.slice();
      const container = document.querySelector('.canvas-area') as HTMLElement | null;
      const containerWidth = container ? container.getBoundingClientRect().width : 800;
      // Render imported PDF pages at high resolution to preserve quality.
      // Use A4 @ 300 DPI as a target rasterization size to avoid visible quality loss when attaching.
      const a4mm = { w: 210, h: 297 };
      const DPI = 300;
      const mmToInch = (mm: number) => mm / 25.4;
      const targetW = Math.round(mmToInch(a4mm.w) * DPI);
      const targetH = Math.round(mmToInch(a4mm.h) * DPI);
      // initialize progress counters
      setImportProgress({ current: 0, total: pdf.numPages });
      for (let p = 1; p <= pdf.numPages; p += 1) {
        const pdfPage = await pdf.getPage(p);
        const viewport = pdfPage.getViewport({ scale: 1 });
        // choose a high rasterization scale so the resulting image preserves vector quality
        // scale to A4@300dpi target width relative to the PDF page width
        const scale = Math.max(1, targetW / viewport.width);
        const renderViewport = pdfPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(renderViewport.width);
        canvas.height = Math.round(renderViewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        // pdfjs types expect a `canvas` property on RenderParameters; pass the canvas element.
        await pdfPage.render({ canvas, viewport: renderViewport } as any).promise;
        const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.add(url);

        // ensure localPages has a slot for this page
        while (localPages.length < p) {
          const np = createPage(localPages.length);
          np.pdfImportGroup = groupId;
          localPages.push(np);
        }

        // create attachment that covers the full page area (store sizes in app CSS pixels)
        const displayWidth = Math.round(containerWidth);
        const displayHeight = Math.round((renderViewport.height / renderViewport.width) * displayWidth);
        const attach: AttachItem = {
          id: createId(),
          x: 0,
          y: 0,
          // width/height are in CSS pixels (canvas drawing uses CSS coordinate space)
          width: displayWidth,
          height: displayHeight,
          src: url,
          name: `${file.name} (page ${p})`,
          locked: true,
          pdfBackgroundGroup: groupId
        };

        const target = localPages[p - 1];
        target.attachments = [attach, ...(target.attachments ?? [])];
        target.pdfImportGroup = groupId;
        pageIds.push(target.id);
        // update progress after each page is processed
        setImportProgress({ current: p, total: pdf.numPages });
      }

      // commit pages and record import group
      setPages(localPages.map((pg, idx) => ({ ...pg, name: `Page ${idx + 1}` })));
      setPdfImports((prev) => [...prev, { id: groupId, name: file.name, pageIds, data: originalBytes }]);
      // select first page of the imported PDF
      if (pageIds.length > 0) setActivePageId(pageIds[0]);
      // done
      setImportingPdf(false);
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert('PDF import failed: ' + (err as Error).message);
      setImportingPdf(false);
      setImportProgress({ current: 0, total: 0 });
      setWorkerStatus('failed');
    }
  };

  const handleSelectAsset = (id: string | null) => {
    setSelectedAssetId(id);
    if (id) setTool('attach');
  };

  const handleAssetDragStart = (e: React.DragEvent, asset: { id: string; name: string; url: string }) => {
    try {
      // Prefer providing a URI so drops create an attachment (not a text box with the name)
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/uri-list', asset.url);
        // Some consumers read text/plain; provide the URL there as well (not the filename)
        e.dataTransfer.setData('text/plain', asset.url);
        // Try to provide a drag image for nicer UX
        const img = new Image();
        img.src = asset.url;
        img.onload = () => {
          try {
            e.dataTransfer?.setDragImage(img, Math.min(32, img.width / 2), Math.min(32, img.height / 2));
          } catch (err) {
            // ignore setDragImage failures
          }
        };
      }
    } catch (err) {
      // defensive: ignore edge cases where dataTransfer is restricted
    }
  };

  // Attach handlers
  const handleAttachCreate = (x: number, y: number, src: string, name?: string) => {
    const id = createId();
    // Insert a small temporary attachment so the UI updates immediately.
    const tempWidth = 120;
    const tempHeight = 90;
    const left = Math.max(0, Math.round(x - tempWidth / 2));
    const top = Math.max(0, Math.round(y - tempHeight / 2));
    const attach: AttachItem = {
      id,
      x: left,
      y: top,
      width: tempWidth,
      height: tempHeight,
      src,
      name: name ?? ''
    };
    // track object URLs so we can revoke them when deleted
    if (src.startsWith('blob:')) objectUrlsRef.current.add(src);
  updateActivePage((page) => ({ ...page, attachments: [...(page.attachments ?? []), attach] }));
  // Do not keep the newly placed attachment selected by default — this avoids
  // staying 'focused' on the image after placement which can be surprising.
  setSelectedAttachId(null);
    setTool('pointer');

    // Asynchronously load the image to size the attachment to its natural dimensions.
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const naturalW = img.naturalWidth || img.width || tempWidth;
          const naturalH = img.naturalHeight || img.height || tempHeight;

          // Prevent extremely large images from overflowing the canvas area by capping to container size.
          const container = document.querySelector('.canvas-area') as HTMLElement | null;
          const containerW = container ? Math.max(80, Math.round(container.getBoundingClientRect().width)) : 800;
          const containerH = container ? Math.max(60, Math.round(container.getBoundingClientRect().height)) : 600;
          const maxW = Math.max(80, Math.round(containerW * 0.9));
          const maxH = Math.max(60, Math.round(containerH * 0.9));

          let newW = naturalW;
          let newH = naturalH;
          const ratio = naturalW && naturalH ? naturalW / naturalH : 1;
          if (newW > maxW) {
            newW = maxW;
            newH = Math.max(1, Math.round(newW / ratio));
          }
          if (newH > maxH) {
            newH = maxH;
            newW = Math.max(1, Math.round(newH * ratio));
          }

          const newLeft = Math.max(0, Math.round(x - newW / 2));
          const newTop = Math.max(0, Math.round(y - newH / 2));

          // Update the attachment dimensions and position
          handleAttachChange(id, { width: newW, height: newH, x: newLeft, y: newTop });
        } catch (e) {
          // ignore sizing errors and keep the temporary size
        }
      };
      img.onerror = () => {
        // leave temporary size if load fails
      };
      img.src = src;
    } catch (e) {
      // ignore image loading errors
    }
  };

  const handleAttachChange = (id: string, changes: Partial<AttachItem>) => {
    updateActivePage((page) => ({
      ...page,
      attachments: (page.attachments ?? []).map((a) => {
        if (a.id !== id) return a;
        if (a.locked) return a;
        return { ...a, ...changes };
      })
    }));
  };

  const handleAttachDelete = (id: string) => {
    // prevent deleting PDF-imported backgrounds
    const attach = activePage.attachments?.find((a) => a.id === id);
    if (attach?.locked) {
      // ignore deletion for locked attachments
      // eslint-disable-next-line no-alert
      alert('This background was imported from a PDF and cannot be deleted here. Use the Import list to remove it.');
      return;
    }
    // revoke object URL if we created it earlier
    if (attach && objectUrlsRef.current.has(attach.src)) {
      try {
        URL.revokeObjectURL(attach.src);
      } catch (e) {
        // ignore
      }
      objectUrlsRef.current.delete(attach.src);
    }
    updateActivePage((page) => ({ ...page, attachments: (page.attachments ?? []).filter((a) => a.id !== id) }));
    if (selectedAttachId === id) setSelectedAttachId(null);
  };

  const handleAttachSelect = (id: string | null) => {
    if (!id) {
      setSelectedAttachId(null);
      return;
    }
    const target = activePage.attachments?.find((a) => a.id === id);
    if (target?.locked) return;
    setSelectedAttachId(id);
  };

  const handleTextSelect = (id: string | null) => {
    setSelectedTextId(id);
    if (!id) return;
    const text = activePage.texts.find((item) => item.id === id);
    if (text) {
      setTextDefaults({
        color: text.color,
        fontSize: text.fontSize,
        fontFamily: text.fontFamily,
        bold: text.bold,
        italic: text.italic,
        underline: text.underline,
        align: text.align,
        width: text.width,
        background: text.background,
        backgroundColor: text.backgroundColor
      });
    }
  };

  const handleTextStyleChange = (changes: Partial<TextItem>) => {
    setTextDefaults((prev) => ({
      ...prev,
      ...(changes.color !== undefined ? { color: changes.color } : {}),
      ...(changes.fontSize !== undefined ? { fontSize: changes.fontSize } : {}),
      ...(changes.fontFamily !== undefined ? { fontFamily: changes.fontFamily } : {}),
      ...(changes.bold !== undefined ? { bold: changes.bold } : {}),
      ...(changes.italic !== undefined ? { italic: changes.italic } : {}),
      ...(changes.underline !== undefined ? { underline: changes.underline } : {}),
      ...(changes.align !== undefined ? { align: changes.align } : {}),
      ...(changes.width !== undefined ? { width: changes.width } : {}),
      ...(changes.background !== undefined ? { background: changes.background } : {}),
      ...(changes.backgroundColor !== undefined ? { backgroundColor: changes.backgroundColor } : {})
    }));
    if (selectedTextId) {
      handleTextChange(selectedTextId, changes);
    }
  };

  const handleAddPage = () => {
    setPages((prev) => {
      const next = createPage(prev.length);
      setActivePageId(next.id);
      return [...prev, next];
    });
    setSelectedTextId(null);
  };

  const handleRemovePage = (id: string) => {
    setPages((prev) => {
      if (prev.length === 1) return prev;
      const toRemove = prev.find((p) => p.id === id);
      // don't allow removing pages that are part of a PDF import here
      if (toRemove?.pdfImportGroup) {
        // eslint-disable-next-line no-alert
        alert('This page is part of an imported PDF and cannot be removed here. Use the Imports list to remove the entire PDF.');
        return prev;
      }
      let filtered = prev.filter((page) => page.id !== id);
      filtered = filtered.map((page, index) => ({
        ...page,
        name: `Page ${index + 1}`
      }));
      if (id === activePageId) {
        setActivePageId(filtered[filtered.length - 1]?.id ?? filtered[0].id);
      }
      return filtered;
    });
    setSelectedTextId(null);
  };

  const handleRemovePdfImport = (groupId: string) => {
    // remove pages and revoke their object URLs
    setPages((prev) => {
      const toRemovePages = prev.filter((p) => p.pdfImportGroup === groupId);
      toRemovePages.forEach((pg) => {
        (pg.attachments ?? []).forEach((a) => {
          if (a.pdfBackgroundGroup === groupId && objectUrlsRef.current.has(a.src)) {
            try {
              URL.revokeObjectURL(a.src);
            } catch (e) {}
            objectUrlsRef.current.delete(a.src);
          }
        });
      });
      const remaining = prev.filter((p) => p.pdfImportGroup !== groupId).map((page, idx) => ({ ...page, name: `Page ${idx + 1}` }));
      // adjust active page if it was removed
      if (!remaining.find((p) => p.id === activePageId)) {
        setActivePageId(remaining[remaining.length - 1]?.id ?? remaining[0]?.id ?? '');
      }
      return remaining;
    });
    setPdfImports((prev) => prev.filter((imp) => imp.id !== groupId));
  };

  const handleClearPage = () => {
    // revoke any object URLs used on this page
    const attachmentsToRevoke = activePage.attachments ?? [];
    attachmentsToRevoke.forEach((a) => {
      if (objectUrlsRef.current.has(a.src)) {
        try {
          URL.revokeObjectURL(a.src);
        } catch (e) {}
        objectUrlsRef.current.delete(a.src);
      }
    });
    updateActivePage((page) => ({
      ...page,
      strokes: [],
      shapes: [],
      texts: [],
      attachments: []
    }));
    setSelectedTextId(null);
  };

  return (
    <div className="app-shell">
      <header className="toolbar" ref={toolbarRef}>
        <div className="toolbar-row">
          <ToolToggle
            options={TOOL_META}
            value={tool}
            onChange={(next) => {
              setTool(next);
              if (next !== 'text') setSelectedTextId(null);
            }}
          />
          </div>
          {/* toolbar-row end. Palette popover appears next when toggled */}
          {/* Attach card does not include colour controls (handled in the Pen/Highlighter card) */}
          {showPalette ? (
    <div className="toolbar-palette-popover" role="dialog" aria-label="Colour palette">
      <div className="popover-row">
        <div>
          <div className="popover-section-title">Pen</div>
          <div className="swatch-grid">
            {penColors.map((c) => (
              <button
                key={c}
                type="button"
                className={clsx('swatch', 'swatch-small', { active: penColor === c })}
                style={{ backgroundColor: c }}
                onClick={() => {
                  setPenColor(c);
                  setShowPalette(false);
                }}
                aria-label={`Select pen color ${c}`}
              />
            ))}
          </div>
          <div className="popover-actions">
            {/* duplicate simple selector removed; swatch-grid covers it */}
          </div>
        </div>

        <div>
          <div className="popover-section-title">Highlighter</div>
          <div className="swatch-grid">
            {highlightColors.map((c) => (
              <button
                key={c}
                type="button"
                className={clsx('swatch', 'swatch-small', { active: highlightColor === c })}
                style={{ backgroundColor: c }}
                onClick={() => {
                  setHighlightColor(c);
                  setShowPalette(false);
                }}
                aria-label={`Select highlight colour ${c}`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="popover-actions">
        <button type="button" className="toolbar-action" onClick={resetPalettes}>Reset palettes</button>
      </div>
    </div>
        ) : null}

        <div className="toolbar-row toolbar-row--cards">
          <section className="control-card control-card--zoom">
            <div className="card-header">
              <span className="card-label">Zoom</span>
              <span className="card-value">{zoomPercent}%</span>
            </div>
            <div className="card-body card-body--zoom">
              <div className="zoom-controls">
                <button
                  type="button"
                  className="zoom-button"
                  onClick={handleZoomOut}
                  disabled={isZoomAtMin}
                  aria-label="Zoom out"
                >
                  −
                </button>
                <input
                  className="density-slider zoom-slider"
                  type="range"
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={0.05}
                  value={zoom}
                  onChange={handleZoomSliderChange}
                  aria-label="Zoom level"
                />
                <button
                  type="button"
                  className="zoom-button"
                  onClick={handleZoomIn}
                  disabled={isZoomAtMax}
                  aria-label="Zoom in"
                >
                  +
                </button>
                <button type="button" className="toolbar-action zoom-reset" onClick={handleZoomReset}>
                  Reset
                </button>
              </div>
            </div>
          </section>

          <section className="control-card">
            <div className="card-header">
              <span className="card-label">Pen / Highlighter</span>
              <span className="card-value">{tool === 'highlighter' ? `${highlightWidth}px · ${Math.round(highlightOpacity * 100)}%` : `${penWidth}px`}</span>
            </div>
            <div className="card-body card-body--stacked">
              <div className="setting-group">
                <span className="setting-label">Mode</span>
                <div className="shape-buttons">
                  <button type="button" className={clsx('shape-button', { active: tool === 'pen' })} onClick={() => setTool('pen')}>Pen</button>
                  <button type="button" className={clsx('shape-button', { active: tool === 'highlighter' })} onClick={() => setTool('highlighter')}>Highlighter</button>
                </div>
              </div>
              <div className="setting-group">
                <span className="setting-label">Colour</span>
                <div className="swatches">
                  {/* show only the active colour and a picker button to open the full palette */}
                  <button
                    type="button"
                    className={clsx('swatch', 'swatch-active-preview')}
                    style={{ backgroundColor: tool === 'highlighter' ? highlightColor : penColor }}
                    aria-label={`Active colour ${tool === 'highlighter' ? highlightColor : penColor}`}
                  />
                  <button
                    type="button"
                    className="tool-toggle__button"
                    title="Open colour palette"
                    aria-label="Open colour palette"
                    onClick={(e) => { e.stopPropagation(); setShowInlinePicker((s) => !s); setShowShapePicker(false); setShowPalette(false); }}
                  >
                    ▾
                  </button>
                </div>
                {showInlinePicker ? (
                  <div ref={inlinePickerRef} className="inline-palette-popover">
                    <ColorPicker
                      value={tool === 'highlighter' ? highlightColor : penColor}
                      onChange={(v) => {
                        setNewColor(v);
                        if (tool === 'highlighter') setHighlightColor(v);
                        else setPenColor(v);
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <div className="setting-group">
                <span className="setting-label">Thickness</span>
                <input
                  className="density-slider"
                  type="range"
                  min={tool === 'highlighter' ? 8 : 1}
                  max={tool === 'highlighter' ? 60 : 30}
                  value={tool === 'highlighter' ? highlightWidth : penWidth}
                  onChange={(event) => (tool === 'highlighter' ? setHighlightWidth(Number(event.target.value)) : setPenWidth(Number(event.target.value)))}
                  aria-label="Tool thickness"
                />
              </div>
              {tool === 'highlighter' ? (
                <div className="setting-group">
                  <span className="setting-label">Intensity</span>
                  <div className="opacity-pills">
                    {HIGHLIGHT_OPACITIES.map((entry) => (
                      <button
                        key={entry.value}
                        type="button"
                        className={clsx('pill', { active: highlightOpacity === entry.value })}
                          onClick={() => setHighlightOpacity(entry.value)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="control-card">
            <div className="card-header">
              <span className="card-label">Shapes</span>
              <span className="card-value">{SHAPE_TYPES.find((shape) => shape.id === shapeType)?.label}</span>
            </div>
            <div className="card-body card-body--stacked">
              <div className="setting-group">
                <span className="setting-label">Type</span>
                <div className="shape-buttons">
                  {SHAPE_TYPES.map((shape) => (
                    <button
                      key={shape.id}
                      type="button"
                      className={clsx('shape-button', { active: shapeType === shape.id })}
                      onClick={() => setShapeType(shape.id)}
                    >
                      {shape.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-group">
                <span className="setting-label">Colour</span>
                <div className="swatches">
                  <button
                    type="button"
                    className={clsx('swatch', 'swatch-active-preview')}
                    style={{ backgroundColor: shapeColor }}
                    aria-label={`Active shape colour ${shapeColor}`}
                  />
                  <button
                    type="button"
                    className="tool-toggle__button"
                    title="Open colour picker"
                    aria-label="Open shape colour picker"
                    onClick={(e) => { e.stopPropagation(); setShowShapePicker((s) => !s); setShowInlinePicker(false); setShowPalette(false); }}
                  >
                    ▾
                  </button>
                </div>
                {showShapePicker ? (
                  <div ref={shapePickerRef} className="inline-palette-popover">
                    <ColorPicker
                      value={shapeColor}
                      onChange={(v) => {
                        setShapeColor(v);
                      }}
                    />
                  </div>
                ) : null}
                <div className="shape-swatch-list">
                  {PEN_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={clsx('swatch', { active: shapeColor === color })}
                      style={{ backgroundColor: color }}
                      onClick={() => setShapeColor(color)}
                      aria-label={`Shape colour ${color}`}
                    />
                  ))}
                </div>
              </div>
              <div className="setting-group">
                <span className="setting-label">Stroke</span>
                <input
                  className="density-slider"
                  type="range"
                  min={1}
                  max={20}
                  value={shapeWidth}
                  onChange={(event) => setShapeWidth(Number(event.target.value))}
                  aria-label="Shape stroke width"
                />
              </div>
            </div>
          </section>

          <section className="control-card">
            <div className="card-header">
              <span className="card-label">Attach</span>
              <span className="card-value">Upload & place</span>
            </div>
            <div className="card-body card-body--stacked">
              <div className="setting-group">
                <span className="setting-label">Upload</span>
                <div className="attach-card">
                  <label className="attach-upload">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden-input"
                        onChange={(e) => handleFilesAdded(e.target.files)}
                      />
                    + Add images
                  </label>
                  {uploadedAssets.length > 0 ? (
                    <div className="attach-gallery">
                      {uploadedAssets.map((a) => {
                        const displayName = a.name.replace(/\.[^/.]+$/, '');
                        return (
                          <button
                            key={a.id}
                            type="button"
                            className={clsx('attach-thumb', { active: selectedAssetId === a.id })}
                            onClick={() => { setSelectedAssetId(a.id); setTool('attach'); }}
                            title={`Select ${displayName}`}
                          >
                            <span className="attach-label">{displayName}</span>
                            <div className="attach-preview" aria-hidden>
                              <img src={a.url} alt={a.name} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {/* PDF import moved to its own section */}
                  {/* folder selection removed: project-assets and uploads are supported via the other controls */}
                  {/* Attach card intentionally has no colour controls; use Pen/Highlighter card to pick colours. */}
                </div>
              </div>
            </div>
          </section>

          <section className="control-card">
            <div className="card-header">
              <span className="card-label">PDF import</span>
              <span className="card-value">Upload PDF as page backgrounds</span>
            </div>
            <div className="card-body card-body--stacked">
              <div className="setting-group">
                <span className="setting-label">Upload</span>
                <div className="pdf-card">
                  <label className="attach-upload">
                    <input
                      type="file"
                      accept="application/pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handlePdfUpload(f);
                        (e.target as HTMLInputElement).value = '';
                      }}
                    />
                    + Import PDF
                  </label>
                  <div className="pdf-import-list">
                    {pdfImports.map((imp) => (
                      <div key={imp.id} className="pdf-import-row">
                        <div className="pdf-name">{imp.name} · {imp.pageIds.length} pages</div>
                        <button type="button" className="pdf-remove" onClick={() => handleRemovePdfImport(imp.id)}>Remove</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="control-card control-card--text">
            <div className="card-header">
              <span className="card-label">Text</span>
              <span className="card-value">{textDefaults.fontSize}px</span>
            </div>
            <div className="card-body card-body--text">
              <div className="setting-group">
                <span className="setting-label">Text colour</span>
                <div className="swatches">
                  <button
                    type="button"
                    className={clsx('swatch', 'swatch-active-preview')}
                    style={{ backgroundColor: textDefaults.color }}
                    aria-label={`Active text colour ${textDefaults.color}`}
                  />
                  <button
                    type="button"
                    className="tool-toggle__button"
                    title="Open text colour picker"
                    aria-label="Open text colour picker"
                    onClick={(e) => { e.stopPropagation(); setShowTextColorPicker((s) => !s); setShowTextBgPicker(false); setShowInlinePicker(false); setShowShapePicker(false); setShowPalette(false); }}
                  >
                    ▾
                  </button>
                </div>
                {showTextColorPicker ? (
                  <div ref={textColorPickerRef} className="inline-palette-popover">
                    <ColorPicker value={textDefaults.color} onChange={(v) => handleTextStyleChange({ color: v })} />
                  </div>
                ) : null}
                <div className="text-swatch-list">
                  {TEXT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={clsx('swatch', { active: textDefaults.color === color })}
                      style={{ backgroundColor: color }}
                      onClick={() => handleTextStyleChange({ color })}
                      aria-label={`Text colour ${color}`}
                    />
                  ))}
                </div>
              </div>
              <div className="setting-group">
                <div className="setting-group__header">
                  <span className="setting-label">Background</span>
                  <button
                    type="button"
                    className={clsx('toggle-pill', { active: textDefaults.background })}
                    onClick={() => handleTextStyleChange({ background: !textDefaults.background })}
                    aria-pressed={textDefaults.background}
                    aria-label={textDefaults.background ? 'Hide background fill' : 'Show background fill'}
                  >
                    {textDefaults.background ? 'Visible' : 'Hidden'}
                  </button>
                </div>
                <div className="swatches swatches-bg swatches-centered">
                  <button
                    type="button"
                    className={clsx('swatch', 'swatch-active-preview', 'swatch-preview')}
                    style={{ backgroundColor: textDefaults.backgroundColor }}
                    aria-label={`Active background colour ${textDefaults.backgroundColor}`}
                  />
                  <button
                    type="button"
                    className="tool-toggle__button"
                    title="Open background colour picker"
                    aria-label="Open text background colour picker"
                    onClick={(e) => { e.stopPropagation(); setShowTextBgPicker((s) => !s); setShowInlinePicker(false); setShowShapePicker(false); setShowPalette(false); }}
                  >
                    ▾
                  </button>
                  {TEXT_BG_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={clsx('swatch swatch-bg', {
                        active: textDefaults.backgroundColor === color
                      })}
                      style={{ backgroundColor: color }}
                      onClick={() => handleTextStyleChange({ backgroundColor: color })}
                      aria-label={`Background colour ${color}`}
                    />
                  ))}
                </div>
                {showTextBgPicker ? (
                  <div ref={textBgPickerRef} className="inline-palette-popover">
                    <ColorPicker value={textDefaults.backgroundColor} onChange={(v) => handleTextStyleChange({ backgroundColor: v })} />
                  </div>
                ) : null}
              </div>
              <div className="text-control-row">
                <div className="text-control">
                  <span className="setting-label">Size</span>
                  <div className="text-size">
                    <input
                      type="number"
                      min={12}
                      max={72}
                      value={textDefaults.fontSize}
                      onChange={(event) =>
                        handleTextStyleChange({ fontSize: Number(event.target.value) })
                      }
                      aria-label="Font size"
                    />
                    <span>px</span>
                  </div>
                </div>
                <div className="text-control">
                  <span className="setting-label">Style</span>
                  <div className="text-style">
                    <button
                      type="button"
                      className={clsx('style-button', { active: textDefaults.bold })}
                      onClick={() => handleTextStyleChange({ bold: !textDefaults.bold })}
                      title="Bold"
                    >
                      B
                    </button>
                    <button
                      type="button"
                      className={clsx('style-button', { active: textDefaults.italic })}
                      onClick={() => handleTextStyleChange({ italic: !textDefaults.italic })}
                      title="Italic"
                    >
                      I
                    </button>
                    <button
                      type="button"
                      className={clsx('style-button', { active: textDefaults.underline })}
                      onClick={() => handleTextStyleChange({ underline: !textDefaults.underline })}
                      title="Underline"
                    >
                      U
                    </button>
                  </div>
                </div>
                <div className="text-control">
                  <span className="setting-label">Alignment</span>
                  <div className="text-align">
                    {(['left', 'center', 'right'] as CanvasTextAlign[]).map((align) => (
                      <button
                        key={align}
                        type="button"
                        className={clsx('style-button', { active: textDefaults.align === align })}
                        onClick={() => handleTextStyleChange({ align })}
                        title={`Align ${align}`}
                      >
                        {align === 'left' ? 'L' : align === 'center' ? 'C' : 'R'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </header>

      {importingPdf ? (
        <div className="pdf-import-overlay" role="status" aria-live="polite">
          <div className="pdf-import-panel">
            <div className="pdf-import-title">Importing PDF</div>
            <div className="pdf-import-meta">{importProgress.current} / {importProgress.total} pages</div>
            <div className="progress">
              <div
                className="progress__bar"
                style={{ width: `${importProgress.total ? Math.round((importProgress.current / importProgress.total) * 100) : 0}%` }}
              />
            </div>
            <div className="pdf-import-worker">{workerStatus === 'available' ? 'Using worker' : workerStatus === 'disabled' ? 'Main-thread rendering' : workerStatus === 'failed' ? 'Worker failed' : 'Worker: unknown'}</div>
          </div>
        </div>
      ) : null}

      <main className="workspace">
        <Canvas
          page={activePage}
          tool={tool}
          penColor={penColor}
          penWidth={penWidth}
          highlighterColor={highlightColor}
          highlighterWidth={highlightWidth}
          highlightOpacity={highlightOpacity}
          shapeType={shapeType}
          shapeColor={shapeColor}
          shapeWidth={shapeWidth}
          selectedTextId={selectedTextId}
          onStrokeEnd={handleStrokeEnd}
          onShapeComplete={handleShapeComplete}
          onTextChange={handleTextChange}
          onTextCreate={handleTextCreate}
          onTextDelete={handleTextDelete}
          onTextSelect={handleTextSelect}
          onEraseStroke={handleEraseStroke}
          onEraseShape={handleEraseShape}
          eraserWidth={eraserWidth}
          onAttachCreate={handleAttachCreate}
          onAttachChange={handleAttachChange}
          onAttachDelete={handleAttachDelete}
          onAttachSelect={handleAttachSelect}
          selectedAttachId={selectedAttachId}
          selectedAsset={selectedAssetId ? uploadedAssets.find((a) => a.id === selectedAssetId) : undefined}
          scale={zoom}
        />
      </main>

      <footer className="page-footer">
        <div className="page-list">
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              className={clsx('page-chip', { active: page.id === activePageId })}
              onClick={() => {
                setActivePageId(page.id);
                setSelectedTextId(null);
              }}
            >
              {page.name}
              {pages.length > 1 && !page.pdfImportGroup ? (
                <span
                  className="remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemovePage(page.id);
                  }}
                >
                  ×
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <button type="button" className="toolbar-action" onClick={handleAddPage}>
          + add page
        </button>
      </footer>
    </div>
  );
};

export default App;

type ToolToggleProps = {
  options: Array<{ id: ToolType; label: string; hint: string }>;
  value: ToolType;
  onChange: (value: ToolType) => void;
};

const ToolToggle = ({ options, value, onChange }: ToolToggleProps) => {
  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === value));
  const segmentPercent = 100 / options.length;
  const leftPercent = segmentPercent * selectedIndex;

  return (
    <div
      className="tool-toggle"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="toolbar"
      aria-label="Drawing tools"
    >
      <div className="tool-toggle__rail" aria-hidden />
      <div
        className="tool-toggle__indicator"
        style={{
          width: `calc(${segmentPercent}% - 8px)`,
          left: `calc(${leftPercent}% + 4px)`
        }}
        aria-hidden
      />
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={clsx('tool-toggle__button', { active: option.id === value })}
          onClick={() => onChange(option.id)}
          title={option.hint}
        >
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
};
