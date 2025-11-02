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
  onTextCreate: (x: number, y: number, initialText?: string) => void;
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
}: CanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      ctx.scale(deviceRatio, deviceRatio);

      // draw attachments first so strokes/shapes appear on top (write-over behavior)
      (page.attachments ?? []).forEach((attach) => {
        try {
          const src = attach.src;
          let img = imageCache.current.get(src);
          if (!img) {
            img = new Image();
            img.src = src;
            img.onload = () => {
              // when image loads, trigger a redraw to show it
              redraw();
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
  }, [page.shapes, page.strokes, redraw]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      canvas.width = width * deviceRatio;
      canvas.height = height * deviceRatio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      setSize({ width, height });
      redraw();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [redraw]);

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
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
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
    },
    [onEraseShape, onEraseStroke, page.shapes, page.strokes, eraserWidth, redraw]
  );

  const finishStroke = useCallback(() => {
    if (strokeDraft.current && strokeDraft.current.points.length > 1) {
      onStrokeEnd(strokeDraft.current);
    }
    strokeDraft.current = null;
    redraw();
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    isPointerDownRef.current = true;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (tool === 'pointer') return;

    if (tool === 'attach') {
      // if a palette asset is selected, place it where the user clicked
      if (selectedAsset) {
        onAttachCreate?.(x, y, selectedAsset.url, selectedAsset.name);
      }
      return;
    }

    if (tool === 'text') {
      onTextCreate(x, y);
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
      redraw({ shape: shapeDraft.current });
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
    redraw({ stroke: newStroke });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    if (shapeDraft.current) {
      shapeDraft.current = {
        ...shapeDraft.current,
        end: { x: event.clientX - rect.left, y: event.clientY - rect.top }
      };
      redraw({ shape: shapeDraft.current });
      return;
    }

    if (tool === 'eraser') {
      if (isPointerDownRef.current) {
        eraseAt(event.clientX - rect.left, event.clientY - rect.top);
      }
      return;
    }

    if (!strokeDraft.current) return;
    strokeDraft.current.points.push({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
    redraw({ stroke: strokeDraft.current });
  };

  const handleCanvasClick = () => {
    if (tool !== 'text') {
      onTextSelect(null);
    }
  };

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const state = dragState.current;
      if (!state) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      if (state.type === 'move') {
        const x = event.clientX - rect.left - state.offsetX;
        const y = event.clientY - rect.top - state.offsetY;
        // decide whether this id is a text or an attachment
        const isText = page.texts.some((t) => t.id === state.id);
        if (isText) {
          onTextChange(state.id, { x, y });
        } else {
          onAttachChange?.(state.id, { x, y });
        }
      } else {
        const width = Math.max(120, state.startWidth + (event.clientX - rect.left - state.originX));
        const isText = page.texts.some((t) => t.id === state.id);
        if (isText) {
          onTextChange(state.id, { width });
        } else {
          // maintain aspect ratio for attachments: scale height in proportion
          const attach = page.attachments?.find((a) => a.id === state.id);
          if (attach) {
            const ratio = attach.height / Math.max(attach.width, 1);
            onAttachChange?.(state.id, { width, height: Math.max(60, Math.round(width * ratio)) });
          } else {
            onAttachChange?.(state.id, { width });
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

  return (
  <div className="canvas-area" ref={containerRef} onPointerDown={handleCanvasClick} onDrop={handleDrop} onDragOver={handleDragOver}>
      {/** use system cursors (crosshair/text/default) per current preference */}
      {
        (() => {
          const cursorForTool = tool === 'pointer' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
          return (
            <canvas
              ref={canvasRef}
              className="canvas-layer"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              style={{ cursor: cursorForTool }}
            />
          );
        })()
      }
      <div className="text-layer" style={{ width: size.width, height: size.height }}>
        {page.texts.map((text) => (
          <TextBox
            key={text.id}
            item={text}
            selected={text.id === selectedTextId}
            tool={tool}
            onSelect={() => onTextSelect(text.id)}
            onChange={(value) => onTextChange(text.id, value)}
            onDelete={() => onTextDelete(text.id)}
            onDrag={(event) => {
              const container = containerRef.current;
              if (!container) return;
              const rect = container.getBoundingClientRect();
              dragState.current = {
                type: 'move',
                id: text.id,
                offsetX: event.clientX - rect.left - text.x,
                offsetY: event.clientY - rect.top - text.y
              };
            }}
            onResize={(event) => {
              const container = containerRef.current;
              if (!container) return;
              const rect = container.getBoundingClientRect();
              dragState.current = {
                type: 'resize',
                id: text.id,
                startWidth: text.width,
                originX: event.clientX - rect.left
              };
            }}
          />
        ))}
        {page.attachments?.map((attach) => (
          <AttachmentBox
            key={attach.id}
            item={attach}
            selected={attach.id === selectedAttachId}
            tool={tool}
            onSelect={() => onAttachSelect?.(attach.id)}
            onChange={(changes) => onAttachChange?.(attach.id, changes)}
            onDelete={() => onAttachDelete?.(attach.id)}
            onDrag={(event) => {
              const container = containerRef.current;
              if (!container) return;
              const rect = container.getBoundingClientRect();
              dragState.current = {
                type: 'move',
                id: attach.id,
                offsetX: event.clientX - rect.left - attach.x,
                offsetY: event.clientY - rect.top - attach.y
              };
            }}
            onResize={(event) => {
              const container = containerRef.current;
              if (!container) return;
              const rect = container.getBoundingClientRect();
              dragState.current = {
                type: 'resize',
                id: attach.id,
                startWidth: attach.width,
                originX: event.clientX - rect.left
              };
            }}
          />
        ))}
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
};

const TextBox = ({ item, selected, tool, onSelect, onChange, onDelete, onDrag, onResize }: TextBoxProps) => {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || node.textContent === item.text) return;
    const active = document.activeElement === node;
    if (!active) {
      node.textContent = item.text;
    }
  }, [item.text]);

  return (
    <div
      className={clsx('text-box', { selected })}
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
        cursor: tool === 'pointer' ? 'grab' : 'text',
        userSelect: tool === 'pointer' ? 'none' : 'text'
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
      <div
        ref={ref}
        className="text-box__content"
        contentEditable={tool === 'text'}
        suppressContentEditableWarning
        spellCheck={tool === 'text'}
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
            onChange({ text: event.currentTarget.textContent ?? '' });
          }
        }}
        onFocus={() => {
          if (tool === 'text') {
            onSelect();
          }
        }}
      />
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
  onChange: (changes: Partial<AttachItem>) => void;
  onDelete: () => void;
  onDrag: (event: React.PointerEvent<HTMLElement>) => void;
  onResize: (event: React.PointerEvent<HTMLDivElement>) => void;
};

const AttachmentBox = ({ item, selected, tool, onSelect, onChange, onDelete, onDrag, onResize }: AttachmentBoxProps) => {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // nothing to sync for now
  }, [item.src]);

  return (
    <div
      ref={ref}
      className={clsx('attachment-box', { selected })}
      style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
        if (tool === 'pointer') {
          event.preventDefault();
          onDrag(event);
        }
      }}
    >
      {/* image is now rendered on the canvas for write-over; overlay shows selection/controls only */}
      {selected ? (
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
