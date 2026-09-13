import { useEffect, useRef, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useRotationContext } from '../../context/RotationContext'
import { normalizeDegrees, degreesToRadians, stepRotation, shortestRotationDelta } from './rotation'
import './RotationPanel.css'

const DIAL_SIZE = 100
const DIAL_CENTER = DIAL_SIZE / 2
const DIAL_RADIUS = 38
const ANIMATE_DURATION_MS = 250

// Screen angle from the dial's center to a pointer position, converted from
// atan2's "0 at 3 o'clock, clockwise positive" convention into this dial's
// "0 at 12 o'clock, clockwise positive" one (matches how DragRotate/compass
// controls read a heading).
function angleFromPointer(dx: number, dy: number): number {
  return normalizeDegrees((Math.atan2(dy, dx) * 180) / Math.PI + 90)
}

function handlePosition(rotationDegrees: number): { x: number; y: number } {
  const rad = degreesToRadians(rotationDegrees - 90)
  return {
    x: DIAL_CENTER + DIAL_RADIUS * Math.cos(rad),
    y: DIAL_CENTER + DIAL_RADIUS * Math.sin(rad),
  }
}

function RotationPanel() {
  const { rotationDegrees, setRotationDegrees } = useRotationContext()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const draggingRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)

  const cancelAnimation = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }

  useEffect(() => cancelAnimation, [])

  // Drives rotationDegrees through the shorter arc from its current value to
  // `target` over ANIMATE_DURATION_MS - used by the quick-adjust buttons.
  // Live dial dragging never goes through this; it sets rotation directly
  // per pointer move instead, so it isn't fighting an animation loop.
  const animateTo = (target: number) => {
    cancelAnimation()
    const from = rotationDegrees
    const delta = shortestRotationDelta(from, target)
    const start = performance.now()

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ANIMATE_DURATION_MS)
      setRotationDegrees(from + delta * t)
      animationFrameRef.current = t < 1 ? requestAnimationFrame(step) : null
    }
    animationFrameRef.current = requestAnimationFrame(step)
  }

  const angleFromEvent = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    return angleFromPointer(event.clientX - cx, event.clientY - cy)
  }

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    cancelAnimation()
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    setRotationDegrees(angleFromEvent(event))
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return
    setRotationDegrees(angleFromEvent(event))
  }

  const stopDragging = (event: ReactPointerEvent<SVGSVGElement>) => {
    draggingRef.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value)
    if (Number.isFinite(value)) {
      cancelAnimation()
      setRotationDegrees(value)
    }
  }

  const handle = handlePosition(rotationDegrees)

  return (
    <div className="rotation-panel">
      <svg
        ref={svgRef}
        className="rotation-panel-dial"
        viewBox={`0 0 ${DIAL_SIZE} ${DIAL_SIZE}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <circle className="rotation-panel-dial-track" cx={DIAL_CENTER} cy={DIAL_CENTER} r={DIAL_RADIUS} />
        <line
          className="rotation-panel-dial-tick"
          x1={DIAL_CENTER}
          y1={DIAL_CENTER - DIAL_RADIUS - 4}
          x2={DIAL_CENTER}
          y2={DIAL_CENTER - DIAL_RADIUS + 4}
        />
        <line
          className="rotation-panel-dial-needle"
          x1={DIAL_CENTER}
          y1={DIAL_CENTER}
          x2={handle.x}
          y2={handle.y}
        />
        <circle className="rotation-panel-dial-handle" cx={handle.x} cy={handle.y} r={6} />
      </svg>

      <label className="rotation-panel-readout">
        Degrees
        <input
          type="number"
          min={0}
          max={359}
          step={1}
          value={Math.round(rotationDegrees)}
          onChange={handleInputChange}
        />
      </label>

      <div className="rotation-panel-quick-adjust">
        <button type="button" onClick={() => animateTo(stepRotation(rotationDegrees, -90))}>-90°</button>
        <button type="button" onClick={() => animateTo(stepRotation(rotationDegrees, -15))}>-15°</button>
        <button type="button" onClick={() => animateTo(stepRotation(rotationDegrees, 15))}>+15°</button>
        <button type="button" onClick={() => animateTo(stepRotation(rotationDegrees, 90))}>+90°</button>
      </div>
      <button type="button" className="rotation-panel-reset" onClick={() => animateTo(0)}>
        Reset
      </button>
    </div>
  )
}

export default RotationPanel
