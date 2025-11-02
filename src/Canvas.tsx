import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { Page, Stroke, TextItem, ToolType } from './types';

type CanvasProps = {
  page: Page;
  tool: ToolType;
  penColor: string;
  penWidth: number;
  highlighterColor: string;
  highlighterWidth: number;
  highlightOpacity: number;
  selectedTextId: string | null;
  onStrokeEnd: (stroke: Stroke) => void;
  onTextChange: (id: string, changes: Partial<TextItem>) => void;
  onTextCreate: (x: number, y: number) => void;
  onTextDelete: (id: string) => void;
  onTextSelect: (id: string | null) => void;
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
  selectedTextId,
  onStrokeEnd,
  onTextChange,
  onTextCreate,
  onTextDelete,
  onTextSelect
}: CanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const strokeDraft = useRef<Stroke | null>(null);
  const dragState = useRef<DragState | null>(null);

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

  const redraw = useCallback(
    (preview?: Stroke | null) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(deviceRatio, deviceRatio);
      page.strokes.forEach((stroke) => drawStroke(ctx, stroke));
      if (preview) {
        drawStroke(ctx, preview);
      }
    },
    [drawStroke, page.strokes]
  );

  useEffect(() => {
    redraw();
  }, [page.strokes, redraw]);

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

  const finishStroke = useCallback(() => {
    if (strokeDraft.current && strokeDraft.current.points.length > 1) {
      onStrokeEnd(strokeDraft.current);
    }
    strokeDraft.current = null;
    redraw();
  }, [onStrokeEnd, redraw]);

  useEffect(() => {
    window.addEventListener('pointerup', finishStroke);
    return () => window.removeEventListener('pointerup', finishStroke);
  }, [finishStroke]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (tool === 'pointer') {
      return;
    }

    if (tool === 'text') {
      onTextCreate(x, y);
      return;
    }

    const strokeColor = tool === 'highlighter' ? highlighterColor : penColor;
    const strokeWidth = tool === 'highlighter' ? highlighterWidth : penWidth;
    const newStroke: Stroke = {
      id: createId(),
      tool,
      color: strokeColor,
      thickness: strokeWidth,
      points: [{ x, y }],
      opacity: tool === 'highlighter' ? highlightOpacity : undefined
    };
    strokeDraft.current = newStroke;
    redraw(newStroke);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!strokeDraft.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    strokeDraft.current.points.push({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
    redraw(strokeDraft.current);
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
        onTextChange(state.id, {
          x: event.clientX - rect.left - state.offsetX,
          y: event.clientY - rect.top - state.offsetY
        });
      } else {
        const width = Math.max(120, state.startWidth + (event.clientX - rect.left - state.originX));
        onTextChange(state.id, { width });
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
    <div className="canvas-area" ref={containerRef} onPointerDown={handleCanvasClick}>
      <canvas
        ref={canvasRef}
        className="canvas-layer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        style={{
          cursor:
            tool === 'pointer'
              ? 'default'
              : tool === 'text'
                ? 'text'
                : 'crosshair'
        }}
      />
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
          <button
            type="button"
            className="text-box__toolbar-btn"
            onClick={onDelete}
            aria-label="Remove text"
          >
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

export default Canvas;
