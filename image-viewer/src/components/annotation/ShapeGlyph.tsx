import type { LineStyleName, ShapeTool } from './Tools'

// A tiny drawing of each shape, for lists - drawn in the annotation's colour.
const SHAPE_PATHS: Record<ShapeTool, string> = {
  line: 'M3 13 L13 3',
  arrow: 'M3 13 L13 3 M7.5 3 L13 3 L13 8.5',
  freehand: 'M2 11 C4 4, 7 14, 9 7 S13 4, 14 9',
  polygon: 'M3 12 L2 6 L8 2 L14 5 L12 13 Z',
  rectangle: 'M2.5 4 H13.5 V12 H2.5 Z',
  circle: 'M8 2.5 A5.5 5.5 0 1 1 7.99 2.5 Z',
}

function ShapeGlyph({ shape, colour }: { shape: ShapeTool; colour: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={SHAPE_PATHS[shape]}
        fill="none"
        stroke={colour}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// A short stretch of line as the annotation draws it - thickness and dashes.
function LinePreview({ colour, thickness, lineStyle }: { colour: string; thickness: number; lineStyle: LineStyleName }) {
  return (
    <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true">
      <line
        x1="2"
        y1="4"
        x2="24"
        y2="4"
        stroke={colour}
        strokeWidth={Math.min(thickness, 6)}
        strokeDasharray={lineStyle === 'dashed' ? '4 3' : undefined}
        strokeLinecap="round"
      />
    </svg>
  )
}

export { ShapeGlyph, LinePreview }
