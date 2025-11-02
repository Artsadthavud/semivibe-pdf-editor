export type ToolType = 'pointer' | 'pen' | 'highlighter' | 'text' | 'shape' | 'eraser';

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
};

export type Page = {
  id: string;
  name: string;
  strokes: Stroke[];
  shapes: Shape[];
  texts: TextItem[];
};
