export type ToolType = 'pointer' | 'pen' | 'highlighter' | 'text' | 'shape' | 'eraser' | 'attach';

export type Point = {
  x: number;
  y: number;
};

export type Stroke = {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  thickness: number;
  points: Point[];
  opacity?: number;
};

export type ShapeType = 'line' | 'rectangle' | 'ellipse' | 'arrow';

export type Shape = {
  id: string;
  type: ShapeType;
  stroke: string;
  strokeWidth: number;
  start: Point;
  end: Point;
};

export type TextItem = {
  id: string;
  x: number;
  y: number;
  width: number;
  text: string;
  color: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: CanvasTextAlign;
  background: boolean;
  backgroundColor: string;
  singleLine?: boolean;
};

export type AttachItem = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string; // object URL or remote URL
  name?: string;
  // if true this attachment was created from an imported PDF page and should not be removed
  locked?: boolean;
  // group id for the originating PDF import
  pdfBackgroundGroup?: string;
};

export type Page = {
  id: string;
  name: string;
  strokes: Stroke[];
  shapes: Shape[];
  texts: TextItem[];
  attachments?: AttachItem[];
  // optional group id if this page was created from a PDF import
  pdfImportGroup?: string;
};
