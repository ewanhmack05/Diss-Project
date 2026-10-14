import type { LineStyleName, ShapeTool } from './Tools'
import arrowIconSvg from '../../icons/shapes/arrow.svg?raw'
import circleIconSvg from '../../icons/shapes/circle.svg?raw'
import freehandIconSvg from '../../icons/shapes/freehand.svg?raw'
import lineIconSvg from '../../icons/shapes/line.svg?raw'
import polygonIconSvg from '../../icons/shapes/polygon.svg?raw'
import rectangleIconSvg from '../../icons/shapes/rectangle.svg?raw'
import './ShapeGlyph.css'

// A tiny drawing of each shape, from icons/shapes - drawn in the
// annotation's colour, or the text colour around it when there isn't one
// (the shape buttons, the filter's shape chips).
const SHAPE_ICONS: Record<ShapeTool, string> = {
  line: lineIconSvg,
  arrow: arrowIconSvg,
  freehand: freehandIconSvg,
  polygon: polygonIconSvg,
  rectangle: rectangleIconSvg,
  circle: circleIconSvg,
}

function ShapeGlyph({ shape, colour }: { shape: ShapeTool; colour?: string }) {
  return (
    <span
      className="shape-glyph"
      style={colour ? { color: colour } : undefined}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: SHAPE_ICONS[shape] }}
    />
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
