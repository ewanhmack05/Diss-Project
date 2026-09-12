import { useEffect, useRef, useState } from 'react'
import { ColorPicker, toColor } from 'react-colour-palette'
import 'react-colour-palette/dist/index.css'
import { PreDefinedColours } from '../annotation/Tools'
import './ColourPicker.css'

interface ColourPickerProps {
  value: string
  onChange: (colour: string) => void
}

function ColourPicker({ value, onChange }: ColourPickerProps) {
  const [customOpen, setCustomOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [pickerWidth, setPickerWidth] = useState(224)

  // react-colour-palette's `width` is a literal pixel number, not a CSS unit -
  // it won't scale with the app's own em-based sizing (including a host's
  // `options.fontSize`), so a fixed value here can end up wider than its
  // container and force a horizontal scrollbar. Track the actual available
  // width instead. containerRef is the outer .colour-picker div, which is
  // stretched to fill its parent regardless of whether the picker itself is
  // open, so it reflects real available space rather than hugging content.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setPickerWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="colour-picker" ref={containerRef}>
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
        type="button"
        className={`colour-picker-custom-toggle${customOpen ? ' colour-picker-custom-toggle--active' : ''}`}
        aria-expanded={customOpen}
        onClick={() => setCustomOpen((open) => !open)}
      >
        Custom
        <span className="colour-picker-custom-toggle-swatch" style={{ backgroundColor: value }} />
      </button>

      {customOpen && (
        <div className="colour-picker-custom-panel">
          <ColorPicker
            color={toColor('hex', value)}
            onChange={(next) => onChange(next.hex)}
            width={pickerWidth}
            height={120}
            hideRGB
            dark
          />
        </div>
      )}
    </div>
  )
}

export default ColourPicker
