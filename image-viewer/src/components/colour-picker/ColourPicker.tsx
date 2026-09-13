import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ColorPicker, toColor } from 'react-colour-palette'
import 'react-colour-palette/dist/index.css'
import { PreDefinedColours } from '../annotation/Tools'
import { computePopupPosition, type Position } from './popupPosition'
import './ColourPicker.css'

interface ColourPickerProps {
  value: string
  onChange: (colour: string) => void
}

const POPUP_WIDTH = 224

function ColourPicker({ value, onChange }: ColourPickerProps) {
  const [customOpen, setCustomOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<Position | null>(null)

  // A fixed-position portal rather than something rendered inline in the
  // panel's own flow - a docked top/bottom panel has a fixed height (see
  // DockEdge.css) with no room for this to grow into, and the panel's own
  // overflow:hidden would otherwise just clip it. Measured in two passes:
  // the popup first renders off-screen (see the style below) so popupRef
  // has a real size to read, then this repositions it before the browser
  // paints (useLayoutEffect, not useEffect), so there's no visible jump.
  useLayoutEffect(() => {
    if (!customOpen) {
      setPosition(null)
      return
    }
    const toggle = toggleRef.current
    const popup = popupRef.current
    if (!toggle || !popup) return

    setPosition(
      computePopupPosition(
        toggle.getBoundingClientRect(),
        { width: popup.offsetWidth, height: popup.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
  }, [customOpen])

  // Standard popup dismissal - an outside click/tap or Escape closes it.
  useEffect(() => {
    if (!customOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (toggleRef.current?.contains(target) || popupRef.current?.contains(target)) return
      setCustomOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCustomOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [customOpen])

  const popupStyle: CSSProperties = position
    ? { top: position.top, left: position.left, visibility: 'visible' }
    : { top: 0, left: 0, visibility: 'hidden' }

  return (
    <div className="colour-picker">
      <div className="colour-picker-swatches">
        {PreDefinedColours.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`colour-picker-swatch${value.toUpperCase() === swatch ? ' colour-picker-swatch--selected' : ''}`}
            style={{ backgroundColor: swatch }}
            aria-label={swatch}
            onClick={() => {
              onChange(swatch)
              setCustomOpen(false)
            }}
          />
        ))}
      </div>

      <button
        ref={toggleRef}
        type="button"
        className={`colour-picker-custom-toggle${customOpen ? ' colour-picker-custom-toggle--active' : ''}`}
        aria-expanded={customOpen}
        onClick={() => setCustomOpen((open) => !open)}
      >
        Custom
        <span className="colour-picker-custom-toggle-swatch" style={{ backgroundColor: value }} />
      </button>

      {customOpen &&
        createPortal(
          <div ref={popupRef} className="colour-picker-custom-panel" style={popupStyle}>
            <ColorPicker
              color={toColor('hex', value)}
              onChange={(next) => onChange(next.hex)}
              width={POPUP_WIDTH}
              height={120}
              hideRGB
              dark
            />
          </div>,
          document.body
        )}
    </div>
  )
}

export default ColourPicker
