import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { Page, Shape, ShapeType, Stroke, TextItem, ToolType, AttachItem } from './types';
// Using system cursors (crosshair/text/default) — remove SVG cursor imports to avoid bundler
// resolution issues and keep behavior consistent across browsers.

type CanvasProps = {
  page: Page;
  tool: ToolType;
  penColor: string;
  penWidth: number;
  highlighterColor: string;
  highlighterWidth: number;
  highlightOpacity: number;
  shapeType: ShapeType;
  shapeColor: string;
  shapeWidth: number;
  selectedTextId: string | null;
  onStrokeEnd: (stroke: Stroke) => void;
  onShapeComplete: (shape: Shape) => void;
  onTextChange: (id: string, changes: Partial<TextItem>) => void;
  // onTextCreate may receive optional client coords so the created TextBox can set the caret at the click
  onTextCreate: (x: number, y: number, initialText?: string, clientX?: number, clientY?: number) => void;
  onTextDelete: (id: string) => void;
  onTextSelect: (id: string | null) => void;
  onAttachCreate?: (x: number, y: number, src: string, name?: string) => void;
  onAttachChange?: (id: string, changes: Partial<AttachItem>) => void;
  onAttachDelete?: (id: string) => void;
  onAttachSelect?: (id: string | null) => void;
  selectedAttachId?: string | null;
  selectedAsset?: { id: string; name: string; url: string } | undefined;
  onEraseStroke?: (id: string) => void;
  onEraseShape?: (id: string) => void;
  eraserWidth?: number;
  // visual scale (zoom). 1.0 = 100%
  scale?: number;
};

type DragState =
  | {
      type: 'move';
      id: string;
      offsetX: number;
      offsetY: number;
    }
  | {
      type: 'resize';
      id: string;
      startWidth: number;
      originX: number;
      // optional vertical resize support
      startHeight?: number;
      originY?: number;
    };

const deviceRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const Canvas = ({
  page,
  tool,
  penColor,
  penWidth,
  highlighterColor,
  highlighterWidth,
  highlightOpacity,
  shapeType,
  shapeColor,
  shapeWidth,
  selectedTextId,
  onStrokeEnd,
  onShapeComplete,
  onTextChange,
  onTextCreate,
  onTextDelete,
  onTextSelect,
  onAttachCreate,
  onAttachChange,
  onAttachDelete,
  onAttachSelect,
  selectedAttachId,
  selectedAsset,
  onEraseStroke,
  onEraseShape,
  eraserWidth
  ,
  scale = 1
}: CanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const topCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const strokeDraft = useRef<Stroke | null>(null);
  const shapeDraft = useRef<Shape | null>(null);
  const dragState = useRef<DragState | null>(null);
  const isPointerDownRef = useRef(false);

  const drawStroke = useCallback(
    (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
      if (stroke.points.length < 2) return;
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = stroke.thickness;
      ctx.strokeStyle = stroke.color;
      ctx.globalAlpha = stroke.tool === 'highlighter' ? stroke.opacity ?? highlightOpacity : 1;

      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i += 1) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    },
    [highlightOpacity]
  );

  const drawShape = useCallback((ctx: CanvasRenderingContext2D, shape: Shape) => {
    const { start, end, stroke, strokeWidth, type } = shape;
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    switch (type) {
      case 'line': {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        break;
      }
      case 'arrow': {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLength = 12 + strokeWidth * 1.5;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - headLength * Math.cos(angle - Math.PI / 6),
          end.y - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - headLength * Math.cos(angle + Math.PI / 6),
          end.y - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();
        break;
      }
      case 'rectangle': {
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);
        ctx.strokeRect(x, y, width, height);
        break;
      }
      case 'ellipse': {
        const radiusX = Math.abs(end.x - start.x) / 2;
        const radiusY = Math.abs(end.y - start.y) / 2;
        const centerX = (start.x + end.x) / 2;
        const centerY = (start.y + end.y) / 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, Math.max(radiusX, 1), Math.max(radiusY, 1), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'check': {
        const left = Math.min(start.x, end.x);
        const top = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        ctx.beginPath();
        ctx.moveTo(left + 0.12 * w, top + 0.55 * h);
        ctx.lineTo(left + 0.42 * w, top + 0.78 * h);
        ctx.lineTo(left + 0.88 * w, top + 0.2 * h);
        ctx.stroke();
        break;
      }
      case 'cross': {
        const left = Math.min(start.x, end.x);
        const top = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        ctx.beginPath();
        ctx.moveTo(left + 0.15 * w, top + 0.15 * h);
        ctx.lineTo(left + 0.85 * w, top + 0.85 * h);
        ctx.moveTo(left + 0.85 * w, top + 0.15 * h);
        ctx.lineTo(left + 0.15 * w, top + 0.85 * h);
        ctx.stroke();
        break;
      }
      case 'plus': {
        const cx = (start.x + end.x) / 2;
        const cy = (start.y + end.y) / 2;
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        const len = Math.max(8, Math.min(w, h) * 0.6);
        ctx.beginPath();
        ctx.moveTo(cx - len / 2, cy);
        ctx.lineTo(cx + len / 2, cy);
        ctx.moveTo(cx, cy - len / 2);
        ctx.lineTo(cx, cy + len / 2);
        ctx.stroke();
        break;
      }
      case 'minus': {
        const cx = (start.x + end.x) / 2;
        const cy = (start.y + end.y) / 2;
        const w = Math.abs(end.x - start.x);
        const len = Math.max(8, w * 0.6);
        ctx.beginPath();
        ctx.moveTo(cx - len / 2, cy);
        ctx.lineTo(cx + len / 2, cy);
        ctx.stroke();
        break;
      }
      case 'times': {
        const left = Math.min(start.x, end.x);
        const top = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        ctx.beginPath();
        ctx.moveTo(left + 0.15 * w, top + 0.15 * h);
        ctx.lineTo(left + 0.85 * w, top + 0.85 * h);
        ctx.moveTo(left + 0.85 * w, top + 0.15 * h);
        ctx.lineTo(left + 0.15 * w, top + 0.85 * h);
        ctx.stroke();
        break;
      }
      case 'divide': {
        const cx = (start.x + end.x) / 2;
        const cy = (start.y + end.y) / 2;
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        const len = Math.max(8, Math.min(w, h) * 0.5);
        ctx.beginPath();
        ctx.moveTo(cx - len / 2, cy);
        ctx.lineTo(cx + len / 2, cy);
        ctx.stroke();
        // dots
        ctx.beginPath();
        const dotR = Math.max(1.5, (ctx.lineWidth || 1) * 1.2);
        ctx.arc(cx, cy - len, dotR, 0, Math.PI * 2);
        ctx.fillStyle = stroke;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy + len, dotR, 0, Math.PI * 2);
        ctx.fill();
        // reset fill style (not strictly necessary)
        ctx.fillStyle = '#000';
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }, []);
  
  const redraw = useCallback(
    (preview?: { stroke?: Stroke | null; shape?: Shape | null }) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // apply device pixel ratio only; visual zoom is handled by the viewport CSS transform
  ctx.scale(deviceRatio, deviceRatio);

  // draw attachments on the base canvas. Strokes/shapes are drawn on the top canvas
  // so they can appear above editable text overlays (enables highlighting text).
  (page.attachments ?? []).forEach((attach) => {
        try {
          const src = attach.src;
          let img = imageCache.current.get(src);
          if (!img) {
            img = new Image();
            img.src = src;
            img.onload = () => {
              // when image loads, trigger a redraw of both layers
              redraw();
              try {
                redrawTop();
              } catch (e) {
                // ignore
              }
            };
            imageCache.current.set(src, img);
          }
          if (img.complete) {
            ctx.drawImage(img, attach.x, attach.y, attach.width, attach.height);
          }
        } catch (err) {
          // ignore transient errors for invalid urls
        }
      });

      // strokes/shapes are rendered to the top canvas (so they visually sit above
      // the `text-layer` DOM nodes). We'll clear and draw them in the caller below
      // using the top canvas's context.
    },
    [drawShape, drawStroke, page]
  );

  const redrawTop = useCallback(
    (preview?: { stroke?: Stroke | null; shape?: Shape | null }) => {
      const top = topCanvasRef.current;
      const ctx = top?.getContext('2d');
      if (!top || !ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, top.width, top.height);
      // apply device pixel ratio only; visual zoom is handled by the viewport CSS transform
      ctx.scale(deviceRatio, deviceRatio);

      page.strokes.forEach((stroke) => drawStroke(ctx, stroke));
      page.shapes.forEach((shape) => drawShape(ctx, shape));

      if (preview?.stroke) {
        drawStroke(ctx, preview.stroke);
      }
      if (preview?.shape) {
        drawShape(ctx, preview.shape);
      }
    },
    [drawShape, drawStroke, page]
  );

  useEffect(() => {
    redraw();
    redrawTop();
  }, [page.shapes, page.strokes, redraw, redrawTop]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      // internal canvas backing pixels should account for device pixel ratio only
      canvas.width = Math.max(1, Math.round(width * deviceRatio));
      canvas.height = Math.max(1, Math.round(height * deviceRatio));
      // visible CSS size matches logical size; zoom is applied via transform
      canvas.style.width = `${Math.round(width)}px`;
      canvas.style.height = `${Math.round(height)}px`;
      // top canvas must match backing size as well
      const top = topCanvasRef.current;
      if (top) {
        top.width = Math.max(1, Math.round(width * deviceRatio));
        top.height = Math.max(1, Math.round(height * deviceRatio));
        top.style.width = `${Math.round(width)}px`;
        top.style.height = `${Math.round(height)}px`;
      }
      setSize({ width, height });
      redraw();
      redrawTop();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [redraw, redrawTop]);

  // drag & drop for attachments
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const s = scale || 1;
    const x = (e.clientX - rect.left + container.scrollLeft) / s;
    const y = (e.clientY - rect.top + container.scrollTop) / s;
    // prefer files (images) when dropped; some platforms include a text/plain
    // entry (for example a blob URL) which should not create a text box for images.
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      onAttachCreate?.(x, y, url, file.name);
      return;
    }

    // If a dragged asset provided a URI (for example via dragstart on an asset list), prefer that
    try {
      const uri = e.dataTransfer?.getData && (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'));
      if (uri) {
        // if the data looks like an image URL (blob:, http(s) or ends with an image extension), create attachment
        const looksLikeImage = /^blob:|^https?:|\.(png|jpe?g|gif|webp|svg)$/i.test(uri);
        if (looksLikeImage) {
          onAttachCreate?.(x, y, uri);
          return;
        }
        // otherwise, fall back to creating text if it's arbitrary text
        if (uri.trim()) {
          onTextCreate?.(x, y, uri);
          return;
        }
      }
    } catch (err) {
      // some browsers may restrict type access; ignore and let text fallback below
    }
  };

  // --- eraser helpers (must be after redraw is defined) ---
  const erasedIdsRef = useRef<Set<string>>(new Set());

  const pointToSegmentDistance = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx: number, yy: number;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const eraseAt = useCallback(
    (x: number, y: number) => {
      const eraserSize = eraserWidth ?? 22;
      // erase strokes by distance to segments
      page.strokes.forEach((stroke) => {
        if (erasedIdsRef.current.has(stroke.id)) return;
        const threshold = (stroke.thickness || 1) / 2 + eraserSize / 2;
        for (let i = 0; i < stroke.points.length - 1; i += 1) {
          const p1 = stroke.points[i];
          const p2 = stroke.points[i + 1];
          const d = pointToSegmentDistance(x, y, p1.x, p1.y, p2.x, p2.y);
          if (d <= threshold) {
            erasedIdsRef.current.add(stroke.id);
            onEraseStroke?.(stroke.id);
            break;
          }
        }
      });

      // erase shapes by proximity to stroke path or inside bbox
      page.shapes.forEach((shape) => {
        if (erasedIdsRef.current.has(shape.id)) return;
        const threshold = (shape.strokeWidth || 1) / 2 + eraserSize / 2;
        const { start, end } = shape;
        switch (shape.type) {
          case 'line':
          case 'arrow': {
            const d = pointToSegmentDistance(x, y, start.x, start.y, end.x, end.y);
            if (d <= threshold) {
              erasedIdsRef.current.add(shape.id);
              onEraseShape?.(shape.id);
            }
            break;
          }
          case 'rectangle': {
            const left = Math.min(start.x, end.x);
            const top = Math.min(start.y, end.y);
            const right = Math.max(start.x, end.x);
            const bottom = Math.max(start.y, end.y);
            // if near border
            const nearLeft = Math.abs(x - left) <= threshold && y >= top - threshold && y <= bottom + threshold;
            const nearRight = Math.abs(x - right) <= threshold && y >= top - threshold && y <= bottom + threshold;
            const nearTop = Math.abs(y - top) <= threshold && x >= left - threshold && x <= right + threshold;
            const nearBottom = Math.abs(y - bottom) <= threshold && x >= left - threshold && x <= right + threshold;
            if (nearLeft || nearRight || nearTop || nearBottom) {
              erasedIdsRef.current.add(shape.id);
              onEraseShape?.(shape.id);
            }
            break;
          }
          case 'ellipse': {
            const centerX = (start.x + end.x) / 2;
            const centerY = (start.y + end.y) / 2;
            const rx = Math.max(Math.abs(end.x - start.x) / 2, 2);
            const ry = Math.max(Math.abs(end.y - start.y) / 2, 2);
            const nx = (x - centerX) / rx;
            const ny = (y - centerY) / ry;
            const dist = Math.sqrt(nx * nx + ny * ny);
            // if near border (dist ~ 1)
            if (Math.abs(dist - 1) * Math.max(rx, ry) <= threshold) {
              erasedIdsRef.current.add(shape.id);
              onEraseShape?.(shape.id);
            }
            break;
          }
          default:
            break;
        }
      });
      // erase text boxes if pointer inside their rect
      page.texts.forEach((text) => {
        if (erasedIdsRef.current.has(text.id)) return;
        const left = text.x;
        const top = text.y;
        const right = text.x + text.width;
        const bottom = text.y + Math.max(24, text.fontSize + 8);
        if (x >= left && x <= right && y >= top && y <= bottom) {
          erasedIdsRef.current.add(text.id);
          onTextDelete(text.id);
        }
      });
      // erase attachments if pointer inside attachment rect
      (page.attachments ?? []).forEach((attach) => {
        if (erasedIdsRef.current.has(attach.id)) return;
        const left = attach.x;
        const top = attach.y;
        const right = attach.x + attach.width;
        const bottom = attach.y + attach.height;
        if (x >= left && x <= right && y >= top && y <= bottom) {
          erasedIdsRef.current.add(attach.id);
          onAttachDelete?.(attach.id);
        }
      });
      redraw();
      try {
        redrawTop();
      } catch (e) {
        // ignore
      }
    },
    [onEraseShape, onEraseStroke, page.shapes, page.strokes, eraserWidth, redraw]
  );

  const finishStroke = useCallback(() => {
    if (strokeDraft.current && strokeDraft.current.points.length > 1) {
      onStrokeEnd(strokeDraft.current);
    }
    strokeDraft.current = null;
    redraw();
    try {
      redrawTop();
    } catch (e) {}
  }, [onStrokeEnd, redraw]);

  const finishShape = useCallback(() => {
    if (shapeDraft.current) {
      const { start, end } = shapeDraft.current;
      if (start.x !== end.x || start.y !== end.y) {
        onShapeComplete(shapeDraft.current);
      }
    }
    shapeDraft.current = null;
    redraw();
    try {
      redrawTop();
    } catch (e) {}
  }, [onShapeComplete, redraw]);

  useEffect(() => {
    const handleUp = () => {
      finishStroke();
      finishShape();
      // mark pointer as released so eraser doesn't act on hover
      isPointerDownRef.current = false;
      // clear erased id set so next interaction can erase same items again
      erasedIdsRef.current.clear();
    };
    window.addEventListener('pointerup', handleUp);
    return () => window.removeEventListener('pointerup', handleUp);
  }, [finishShape, finishStroke]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = topCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    isPointerDownRef.current = true;
    const rect = container.getBoundingClientRect();
    const s = scale || 1;
    const x = (event.clientX - rect.left + container.scrollLeft) / s;
    const y = (event.clientY - rect.top + container.scrollTop) / s;

    if (tool === 'pointer') return;

    if (tool === 'attach') {
      // if a palette asset is selected, place it where the user clicked
      if (selectedAsset) {
        onAttachCreate?.(x, y, selectedAsset.url, selectedAsset.name);
      }
      return;
    }

    if (tool === 'text') {
      onTextCreate(x, y, undefined, event.clientX, event.clientY);
      return;
    }

    if (tool === 'shape') {
      shapeDraft.current = {
        id: createId(),
        type: shapeType,
        stroke: shapeColor,
        strokeWidth: shapeWidth,
        start: { x, y },
        end: { x, y }
      };
      redrawTop({ shape: shapeDraft.current });
      return;
    }

    if (tool === 'eraser') {
      // start erasing at this point (clear previous erased ids for a fresh stroke)
      erasedIdsRef.current.clear();
      eraseAt(x, y);
      return;
    }

    const strokeColor = tool === 'highlighter' ? highlighterColor : penColor;
    const strokeWidth = tool === 'highlighter' ? highlighterWidth : penWidth;
    const strokeTool = tool === 'highlighter' ? 'highlighter' : 'pen';
    const newStroke: Stroke = {
      id: createId(),
      tool: strokeTool,
      color: strokeColor,
      thickness: strokeWidth,
      points: [{ x, y }],
      opacity: strokeTool === 'highlighter' ? highlightOpacity : undefined
    };
    strokeDraft.current = newStroke;
    redrawTop({ stroke: newStroke });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = topCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const s = scale || 1;
    const clientX = event.clientX - rect.left + container.scrollLeft;
    const clientY = event.clientY - rect.top + container.scrollTop;

    if (shapeDraft.current) {
      shapeDraft.current = {
        ...shapeDraft.current,
        end: { x: clientX / s, y: clientY / s }
      };
      redrawTop({ shape: shapeDraft.current });
      return;
    }

    if (tool === 'eraser') {
      if (isPointerDownRef.current) {
        eraseAt(clientX / s, clientY / s);
      }
      return;
    }

    if (!strokeDraft.current) return;
    strokeDraft.current.points.push({
      x: clientX / s,
      y: clientY / s
    });
    redrawTop({ stroke: strokeDraft.current });
  };

  const handleCanvasClick = () => {
    // clicking the canvas should clear selection of text and attachments
    if (tool !== 'text') {
      onTextSelect(null);
    }
    onAttachSelect?.(null);
  };

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const state = dragState.current;
      if (!state) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      if (state.type === 'move') {
        const s = scale || 1;
        const clientX = event.clientX - rect.left + container.scrollLeft;
        const clientY = event.clientY - rect.top + container.scrollTop;
        const x = clientX / s - state.offsetX;
        const y = clientY / s - state.offsetY;
        // decide whether this id is a text or an attachment
        const isText = page.texts.some((t) => t.id === state.id);
        if (isText) {
          onTextChange(state.id, { x, y });
        } else {
          onAttachChange?.(state.id, { x, y });
        }
      } else {
        const s = scale || 1;
        const isText = page.texts.some((t) => t.id === state.id);
        const originX = (state as any).originX ?? 0;
        const originY = (state as any).originY ?? 0;
        const startW = (state as any).startWidth ?? 120;
        const startH = (state as any).startHeight ?? 24;
        const clientX = event.clientX - rect.left + container.scrollLeft;
        const clientY = event.clientY - rect.top + container.scrollTop;
        const dx = clientX / s - originX;
        const dy = clientY / s - originY;
        const newW = Math.max(60, Math.round(startW + dx));
        const newH = Math.max(24, Math.round(startH + dy));

        if (isText) {
          onTextChange(state.id, { width: newW });
        } else {
          const attach = page.attachments?.find((a) => a.id === state.id);
          if (attach) {
            onAttachChange?.(state.id, { width: newW, height: newH });
          } else {
            onAttachChange?.(state.id, { width: newW });
          }
        }
      }
    };

    const handleUp = () => {
      dragState.current = null;
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [onTextChange]);

  const cursorForTool = tool === 'pointer' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  const zoom = scale || 1;
  const baseWidth = Math.max(1, size.width);
  const baseHeight = Math.max(1, size.height);

  return (
    <div className="canvas-area" ref={containerRef} onPointerDown={handleCanvasClick} onDrop={handleDrop} onDragOver={handleDragOver}>
      <div
        className="canvas-scale"
        style={{ width: Math.max(1, Math.round(baseWidth * zoom)), height: Math.max(1, Math.round(baseHeight * zoom)) }}
      >
        <div
          ref={viewportRef}
          className="canvas-viewport"
          style={{
            width: Math.round(baseWidth),
            height: Math.round(baseHeight),
            transform: `scale(${zoom})`
          }}
        >
          <canvas
            ref={canvasRef}
            className="canvas-layer"
            style={{ cursor: cursorForTool }}
          />
          {/* Visual outline of the actual PDF/page bounds so users can tell where the page edge is when zoomed out */}
          <div
            className="page-outline"
            aria-hidden={true}
            style={{ left: 0, top: 0, width: baseWidth, height: baseHeight }}
          />
          <div className="text-layer" style={{ width: baseWidth, height: baseHeight }}>
            {/* Render attachments first so text boxes sit above them in the DOM.
                This prevents attachments from intercepting pointer events when
                users try to interact with text placed on top of images. */}
            {page.attachments?.map((attach) => (
              <AttachmentBox
                key={attach.id}
                item={attach}
                selected={attach.id === selectedAttachId}
                tool={tool}
                onSelect={() => onAttachSelect?.(attach.id)}
                onDelete={() => onAttachDelete?.(attach.id)}
                onDrag={(event) => {
                  const container = containerRef.current;
                  if (!container) return;
                  const rect = container.getBoundingClientRect();
                  const s = scale || 1;
                  const clientX = event.clientX - rect.left + container.scrollLeft;
                  const clientY = event.clientY - rect.top + container.scrollTop;
                  dragState.current = {
                    type: 'move',
                    id: attach.id,
                    offsetX: clientX / s - attach.x,
                    offsetY: clientY / s - attach.y
                  };
                }}
                onResize={(event) => {
                  const container = containerRef.current;
                  if (!container) return;
                  const rect = container.getBoundingClientRect();
                  const s = scale || 1;
                  const clientX = event.clientX - rect.left + container.scrollLeft;
                  const clientY = event.clientY - rect.top + container.scrollTop;
                  dragState.current = {
                    type: 'resize',
                    id: attach.id,
                    startWidth: attach.width,
                    startHeight: attach.height,
                    originX: clientX / s,
                    originY: clientY / s
                  };
                }}
              />
            ))}

            {page.texts.map((text) => (
              <TextBox
                key={text.id}
                item={text}
                selected={text.id === selectedTextId}
                tool={tool}
                onSelect={() => onTextSelect(text.id)}
                onChange={(value) => onTextChange(text.id, value)}
                onDelete={() => onTextDelete(text.id)}
                scale={scale}
                onDrag={(event) => {
                  const container = containerRef.current;
                  if (!container) return;
                  const rect = container.getBoundingClientRect();
                  const s = scale || 1;
                  const clientX = event.clientX - rect.left + container.scrollLeft;
                  const clientY = event.clientY - rect.top + container.scrollTop;
                  dragState.current = {
                    type: 'move',
                    id: text.id,
                    offsetX: clientX / s - text.x,
                    offsetY: clientY / s - text.y
                  };
                }}
                onResize={(event) => {
                  const container = containerRef.current;
                  if (!container) return;
                  const rect = container.getBoundingClientRect();
                  const s = scale || 1;
                  const clientX = event.clientX - rect.left + container.scrollLeft;
                  const clientY = event.clientY - rect.top + container.scrollTop;
                  dragState.current = {
                    type: 'resize',
                    id: text.id,
                    startWidth: text.width,
                    startHeight: Math.max(24, text.fontSize + 8),
                    originX: clientX / s,
                    originY: clientY / s
                  };
                }}
              />
            ))}
          </div>
          {/* top canvas renders strokes/shapes so highlights sit above editable text */}
          <canvas
            ref={topCanvasRef}
            className="canvas-layer canvas-top"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            style={{
              cursor: cursorForTool,
              // capture pointer events when in a drawing/erase/shape or text tool
              // so the top canvas can handle creating text and drawing.
              pointerEvents:
                tool === 'pen' || tool === 'highlighter' || tool === 'eraser' || tool === 'shape' || tool === 'text'
                  ? 'auto'
                  : 'none',
              position: 'absolute',
              left: 0,
              top: 0
            }}
          />
        </div>
      </div>
    </div>
  );
};

type TextBoxProps = {
  item: TextItem;
  selected: boolean;
  tool: ToolType;
  onSelect: () => void;
  onChange: (changes: Partial<TextItem>) => void;
  onDelete: () => void;
  onDrag: (event: React.PointerEvent<HTMLElement>) => void;
  onResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  scale?: number;
};
const TextBox = ({ item, selected, tool, onSelect, onChange, onDelete, onDrag, onResize, scale }: TextBoxProps) => {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || node.textContent === item.text) return;
    const active = document.activeElement === node;
    if (!active) {
      node.textContent = item.text;
    }
  }, [item.text]);

  // When a text box is selected and the tool is text, focus it and position the caret.
  // Use the click client coordinates if available and fall back to a measured position.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (selected && tool === 'text') {
      // If the node is already focused (user is typing), don't reposition the caret —
      // running this effect on every item update would force the caret to the start.
      try {
        if (document.activeElement === node) return;
      } catch (e) {
        // ignore access errors
      }
      try {
        node.focus();
        const cx = (item as any).initialClientX;
        const cy = (item as any).initialClientY;

        // If we have client coords, first try the browser's point-based caret APIs which are
        // the most accurate for positioning a caret at a click location inside a contentEditable.
        if (typeof cx === 'number' && typeof cy === 'number') {
          try {
            // @ts-ignore - vendor APIs
            const doc: any = document;
            let range: Range | null = null;
            if (typeof doc.caretRangeFromPoint === 'function') {
              // Chromium / WebKit
              // @ts-ignore
              range = doc.caretRangeFromPoint(cx, cy);
            } else if (typeof doc.caretPositionFromPoint === 'function') {
              // Firefox
              // @ts-ignore
              const pos = doc.caretPositionFromPoint(cx, cy);
              if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.collapse(true);
              }
            }

            if (range) {
              // Ensure range is inside our editable node; if not, try to translate to a child text node
              let startNode = range.startContainer as Node | null;
              if (startNode && startNode.nodeType === Node.ELEMENT_NODE && startNode !== node) {
                // try to descend into the element under point
                const findTextNodeAt = (el: Element): Text | null => {
                  for (const ch of Array.from(el.childNodes)) {
                    if (ch.nodeType === Node.TEXT_NODE) return ch as Text;
                    if (ch.nodeType === Node.ELEMENT_NODE) {
                      const res = findTextNodeAt(ch as Element);
                      if (res) return res;
                    }
                  }
                  return null;
                };
                const textNode = findTextNodeAt(startNode as Element) || findTextNodeAt(node as Element);
                if (textNode) {
                  // compute localX relative to the node to estimate character offset
                  const rect = node.getBoundingClientRect();
                  const cs = window.getComputedStyle(node);
                  const paddingLeft = parseFloat(cs.paddingLeft || '0');
                  const s = scale || 1;
                  // account for the visual CSS scale applied to the viewport
                  const localX = (cx - rect.left - paddingLeft) / s;

                  // measure per-character to find nearest offset (works for proportional fonts)
                  const canvas = document.createElement('canvas');
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    const fontSpec = `${item.bold ? '700' : '400'} ${item.fontSize}px ${item.fontFamily}`;
                    ctx.font = fontSpec;
                  }
                  const text = textNode.data || '';
                  let lo = 0;
                  let hi = text.length;
                  // binary search by measured width to find offset faster
                  while (lo < hi) {
                    const mid = Math.floor((lo + hi) / 2);
                    const w = ctx ? ctx.measureText(text.slice(0, mid)).width : mid * (item.fontSize * 0.6);
                    if (w < (localX || 0)) lo = mid + 1;
                    else hi = mid;
                  }
                  const offset = Math.max(0, Math.min(text.length, lo - 1));
                  const r2 = document.createRange();
                  r2.setStart(textNode, offset);
                  r2.collapse(true);
                  range = r2;
                }
              }

              const sel = window.getSelection();
              if (sel && range) {
                sel.removeAllRanges();
                sel.addRange(range);
              }

              // clear initial client coords so we don't reapply on future renders
              try {
                onChange({ initialClientX: undefined, initialClientY: undefined });
              } catch (e) {
                // ignore
              }
              return;
            }
          } catch (err) {
            // swallow and fall back to measured approach below
          }
        }

        // If point-based APIs failed or weren't available, compute an approximate caret offset
        // using measured character width as a fallback.
        if (typeof cx === 'number') {
          const rect = node.getBoundingClientRect();
          const cs = window.getComputedStyle(node);
          const paddingLeft = parseFloat(cs.paddingLeft || '0');
          const s = scale || 1;
          const localX = (cx - rect.left - paddingLeft) / s;
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const fontSpec = `${item.bold ? '700' : '400'} ${item.fontSize}px ${item.fontFamily}`;
            ctx.font = fontSpec;
          }
          const sampleWidth = ctx ? ctx.measureText('M').width : item.fontSize * 0.6;
          const approxIndex = Math.max(0, Math.round((localX || 0) / (sampleWidth || 1)));

          // find first text node (or create one) and place caret at approxIndex
          const findTextNode = (n: Node): Text | null => {
            for (const ch of Array.from(n.childNodes)) {
              if (ch.nodeType === Node.TEXT_NODE) return ch as Text;
              const found = findTextNode(ch);
              if (found) return found;
            }
            return null;
          };
          let textNode = findTextNode(node);
          if (!textNode) {
            textNode = document.createTextNode('');
            node.appendChild(textNode);
          }
          const offset = Math.min((textNode.data || '').length, approxIndex);
          const r = document.createRange();
          r.setStart(textNode, offset);
          r.collapse(true);
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(r);
          }

          // clear initial client coords so we don't reapply on future renders
          try {
            onChange({ initialClientX: undefined, initialClientY: undefined });
          } catch (e) {
            // ignore
          }
          return;
        }

        // Ensure there is at least a caret range (start of node) if everything else fails
        const fallbackRange = document.createRange();
        fallbackRange.selectNodeContents(node);
        fallbackRange.collapse(true);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(fallbackRange);
        }
      } catch (e) {
        // ignore focus/selection failures
      }
    }
  }, [selected, tool, item, onChange]);

  return (
    <div
      className={clsx('text-box', { selected, 'grip-visible': selected && tool !== 'text' })}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        color: item.color,
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        fontWeight: item.bold ? 600 : 400,
        fontStyle: item.italic ? 'italic' : 'normal',
        textDecoration: item.underline ? 'underline' : 'none',
        textAlign: item.align,
        backgroundColor: item.background ? `${item.backgroundColor}E6` : 'transparent',
        boxShadow: item.background ? '0 8px 18px rgba(15, 23, 42, 0.15)' : 'none',
        borderColor: item.background ? 'transparent' : 'transparent',
        cursor: tool === 'pointer' ? 'grab' : 'text'
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
        if (tool === 'pointer') {
          event.preventDefault();
          onDrag(event);
        }
      }}
    >
      {/* left grip for moving when selected - like the screenshot */}
      {/* show the left drag grip only when the box is selected and NOT in text-edit mode
          to avoid the grip overlapping the contentEditable area while typing */}
      {selected && tool !== 'text' ? (
        <div
          className="text-box__grip"
          onPointerDown={(event) => {
            event.stopPropagation();
            onSelect();
            try {
              // blur any focused element (remove caret) so dragging works after editing
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            } catch (e) {
              // ignore
            }
            event.preventDefault();
            onDrag(event);
          }}
          title="Drag"
        >
          <span className="grip-dots">⋮</span>
        </div>
      ) : null}
      <div
        ref={ref}
        className={clsx('text-box__content', { 'single-line': item.singleLine })}
        data-placeholder="Start typing here..."
        contentEditable={true}
        suppressContentEditableWarning
        spellCheck={tool === 'text'}
        style={{
          pointerEvents: tool === 'text' ? 'auto' : 'none',
          userSelect: tool === 'text' ? 'text' : 'none'
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect();
          if (tool === 'pointer') {
            event.preventDefault();
            onDrag(event);
          }
        }}
        onInput={(event) => {
          if (tool === 'text') {
            const newText = event.currentTarget.textContent ?? '';
            onChange({ text: newText });
            // if in single-line mode, expand width as user types to fit content
            if (item.singleLine) {
              const node = ref.current;
              const measured = node ? node.scrollWidth : item.width;
              onChange({ width: Math.max(120, Math.ceil(measured + 12)) });
            }
          }
        }}
        onFocus={() => {
          if (tool === 'text') {
            onSelect();
          }
        }}
      />
      {/* right-side circular resize handle (visible when selected) */}
      {selected ? (
        <div
          className="text-box__handle"
          onPointerDown={(event) => {
            event.stopPropagation();
            onResize(event as React.PointerEvent<HTMLDivElement>);
          }}
          title="Resize"
        />
      ) : null}
      {selected ? (
        <div className="text-box__toolbar">
          <button type="button" className="text-box__toolbar-btn" onClick={onDelete} aria-label="Remove text">
            🗑
          </button>
          <div
            className="text-box__resize"
            onPointerDown={(event) => {
              event.stopPropagation();
              onResize(event);
            }}
          />
          <button
            type="button"
            className={clsx('text-box__toolbar-chip', { active: item.background })}
            onClick={() => onChange({ background: !item.background })}
                    aria-pressed={item.background}
            aria-label={item.background ? 'Hide background fill' : 'Show background fill'}
          >
            <span className="chip-indicator" aria-hidden />
            <span>Bg</span>
          </button>
          <button
            type="button"
            className={clsx('text-box__toolbar-chip', { active: item.singleLine })}
            onClick={() => {
              // toggle singleLine; when enabling, measure content and expand width to fit
              const willSingle = !item.singleLine;
              if (willSingle) {
                const node = ref.current;
                const measured = node ? node.scrollWidth : item.width;
                onChange({ singleLine: true, width: Math.max(120, Math.ceil(measured + 12)) });
              } else {
                onChange({ singleLine: false });
              }
            }}
            aria-pressed={item.singleLine}
            aria-label={item.singleLine ? 'Disable single-line' : 'Enable single-line'}
          >
            1-line
          </button>
        </div>
      ) : null}
    </div>
  );
};

type AttachmentBoxProps = {
  item: AttachItem;
  selected: boolean;
  tool: ToolType;
  onSelect: () => void;
  onDelete: () => void;
  onDrag: (event: React.PointerEvent<HTMLElement>) => void;
  onResize: (event: React.PointerEvent<HTMLDivElement>) => void;
};

const AttachmentBox = ({ item, selected, tool, onSelect, onDelete, onDrag, onResize }: AttachmentBoxProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const isLocked = !!item.locked;
  const isSelected = selected && !isLocked;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // nothing to sync for now
  }, [item.src]);

  return (
    <div
      ref={ref}
      className={clsx('attachment-box', { selected: isSelected, locked: isLocked })}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        // When a drawing tool or the text tool is active, let pointer events pass
        // through so the underlying canvas receives them (enables write-over
        // and creating text on top of attachments). For pointer/attach modes
        // keep pointer events enabled so selection and dragging work.
        pointerEvents: isLocked
          ? 'none'
          : tool === 'pen' || tool === 'highlighter' || tool === 'eraser' || tool === 'shape' || tool === 'text'
            ? 'none'
            : 'auto'
      }}
      onPointerDown={(event) => {
        if (isLocked) return;
        // Allow drawing tools to pass the pointer event through to the canvas
        // so users can draw/write over attachments. For pointer (move) tool we
        // intercept to start dragging. For drawing tools (pen/highlighter/eraser/shape)
        // do not stop propagation so canvas handlers receive the event.
        if (tool === 'pen' || tool === 'highlighter' || tool === 'eraser' || tool === 'shape') {
          // select the attachment but allow the event to bubble to the canvas
          onSelect();
          return;
        }
        // For other tools (pointer/attach/text) intercept the event to support selection/dragging
        event.stopPropagation();
        onSelect();
        if (tool === 'pointer') {
          event.preventDefault();
          onDrag(event);
        }
      }}
    >
      {/* image is now rendered on the canvas for write-over; overlay shows selection/controls only */}
      {isSelected ? (
        <>
          <div
            className="attachment__resize"
            onPointerDown={(event) => {
              event.stopPropagation();
              onResize(event);
            }}
          />
          <button type="button" className="attachment__delete" onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label="Remove attachment">×</button>
        </>
      ) : null}
    </div>
  );
};

export default Canvas;
