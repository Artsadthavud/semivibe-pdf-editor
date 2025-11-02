import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import clsx from 'clsx';
import Canvas from './Canvas';
import type { Page, Shape, ShapeType, Stroke, TextItem, ToolType } from './types';

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

const PEN_COLORS = ['#111827', '#1d4ed8', '#dc2626', '#f97316', '#059669', '#0ea5e9'];
const HIGHLIGHT_COLORS = ['#fde047', '#fb7185', '#38bdf8', '#a855f7', '#4ade80'];
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
  { id: 'arrow', label: 'Arrow' }
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
  texts: []
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
});

const TOOL_META: Array<{ id: ToolType; label: string; hint: string }> = [
  { id: 'pointer', label: 'Pointer', hint: 'Pointer tool (Esc)' },
  { id: 'pen', label: 'Pen', hint: 'Pen tool (P)' },
  { id: 'highlighter', label: 'Highlight', hint: 'Highlighter (H)' },
  { id: 'shape', label: 'Shapes', hint: 'Shapes (S)' },
  { id: 'text', label: 'Text', hint: 'Text tool (T)' },
  { id: 'eraser', label: 'Eraser', hint: 'Eraser (E)' }
];

const App = () => {
  const firstPage = useMemo(() => createPage(0), []);
  const [pages, setPages] = useState<Page[]>([firstPage]);
  const [activePageId, setActivePageId] = useState(firstPage.id);
  const [tool, setTool] = useState<ToolType>('pointer');
  const [penColor, setPenColor] = useState('#1d4ed8');
  const [penWidth, setPenWidth] = useState(4);
  const [highlightColor, setHighlightColor] = useState('#fde047');
  const [highlightWidth, setHighlightWidth] = useState(18);
  const [highlightOpacity, setHighlightOpacity] = useState(0.55);
  const [shapeType, setShapeType] = useState<ShapeType>('rectangle');
  const [shapeColor, setShapeColor] = useState('#1d4ed8');
  const [shapeWidth, setShapeWidth] = useState(3);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [textDefaults, setTextDefaults] = useState<TextDefaults>(defaultText);
  const [eraserWidth, setEraserWidth] = useState(24);

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

  const handleTextCreate = (x: number, y: number) => {
    const safeX = Math.max(24, x - textDefaults.width / 2);
    const safeY = Math.max(24, y);
    const text = createText(safeX, safeY, textDefaults);
    updateActivePage((page) => ({
      ...page,
      texts: [...page.texts, text]
    }));
    setSelectedTextId(text.id);
    setTool('text');
  };

  const handleTextDelete = (id: string) => {
    updateActivePage((page) => ({
      ...page,
      texts: page.texts.filter((text) => text.id !== id)
    }));
    if (selectedTextId === id) {
      setSelectedTextId(null);
    }
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

  const handleClearPage = () => {
    updateActivePage((page) => ({
      ...page,
      strokes: [],
      shapes: [],
      texts: []
    }));
    setSelectedTextId(null);
  };

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="toolbar-row">
          <ToolToggle
            options={TOOL_META}
            value={tool}
            onChange={(next) => {
              setTool(next);
              if (next !== 'text') {
                setSelectedTextId(null);
              }
            }}
          />
          <div className="toolbar-actions">
            <button
              type="button"
              className="toolbar-action"
              onClick={undo}
              disabled={!canUndo()}
              aria-label="Undo"
              title="Undo (Ctrl/Cmd+Z)"
            >
              Undo
            </button>
            <button
              type="button"
              className="toolbar-action"
              onClick={redo}
              disabled={!canRedo()}
              aria-label="Redo"
              title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
            >
              Redo
            </button>
            <button
              type="button"
              className="toolbar-action"
              onClick={() => {
                setTool('text');
                setSelectedTextId(null);
              }}
              title="Switch to text tool (T)"
            >
              Text tool
            </button>
            <button type="button" className="toolbar-action" onClick={handleClearPage}>
              Clear page
            </button>
          </div>
        </div>

        <div className="toolbar-row toolbar-row--cards">
          <section className="control-card">
            <div className="card-header">
              <span className="card-label">Pen</span>
              <span className="card-value">{penWidth}px</span>
            </div>
            <div className="card-body card-body--stacked">
              <div className="setting-group">
                <span className="setting-label">Colour</span>
                <div className="swatches">
                  {PEN_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={clsx('swatch', { active: penColor === color })}
                      style={{ backgroundColor: color }}
                      onClick={() => setPenColor(color)}
                      aria-label={`Pen colour ${color}`}
                    />
                  ))}
                </div>
              </div>
              <div className="setting-group">
                <span className="setting-label">Thickness</span>
                <input
                  className="density-slider"
                  type="range"
                  min={1}
                  max={30}
                  value={penWidth}
                  onChange={(event) => setPenWidth(Number(event.target.value))}
                  aria-label="Pen thickness"
                />
              </div>
            </div>
          </section>

          <section className="control-card">
            <div className="card-header">
              <span className="card-label">Highlight</span>
              <span className="card-value">
                {highlightWidth}px · {Math.round(highlightOpacity * 100)}%
              </span>
            </div>
            <div className="card-body card-body--stacked">
              <div className="setting-group">
                <span className="setting-label">Colour</span>
                <div className="swatches">
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={clsx('swatch', { active: highlightColor === color })}
                      style={{ backgroundColor: color }}
                      onClick={() => setHighlightColor(color)}
                      aria-label={`Highlight colour ${color}`}
                    />
                  ))}
                </div>
              </div>
              <div className="setting-group">
                <span className="setting-label">Thickness</span>
                <input
                  className="density-slider"
                  type="range"
                  min={8}
                  max={60}
                  value={highlightWidth}
                  onChange={(event) => setHighlightWidth(Number(event.target.value))}
                  aria-label="Highlight thickness"
                />
              </div>
              <div className="setting-group">
                <span className="setting-label">Intensity</span>
                <div className="opacity-pills">
                  {HIGHLIGHT_OPACITIES.map((entry) => (
                    <button
                      key={entry.value}
                      type="button"
                      className={clsx('pill', { active: highlightOpacity === entry.value })}
                      onClick={() => setHighlightOpacity(entry.value)}
                      aria-pressed={highlightOpacity === entry.value}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
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

          <section className="control-card control-card--text">
            <div className="card-header">
              <span className="card-label">Text</span>
              <span className="card-value">{textDefaults.fontSize}px</span>
            </div>
            <div className="card-body card-body--text">
              <div className="setting-group">
                <span className="setting-label">Text colour</span>
                <div className="swatches">
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
                  >
                    {textDefaults.background ? 'Visible' : 'Hidden'}
                  </button>
                </div>
                <div className="swatches swatches-bg">
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
                      aria-pressed={textDefaults.bold}
                      title="Bold"
                    >
                      B
                    </button>
                    <button
                      type="button"
                      className={clsx('style-button', { active: textDefaults.italic })}
                      onClick={() => handleTextStyleChange({ italic: !textDefaults.italic })}
                      aria-pressed={textDefaults.italic}
                      title="Italic"
                    >
                      I
                    </button>
                    <button
                      type="button"
                      className={clsx('style-button', { active: textDefaults.underline })}
                      onClick={() => handleTextStyleChange({ underline: !textDefaults.underline })}
                      aria-pressed={textDefaults.underline}
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
                        aria-pressed={textDefaults.align === align}
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
              {pages.length > 1 ? (
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
      role="tablist"
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
          aria-pressed={option.id === value}
          role="tab"
          title={option.hint}
        >
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
};
