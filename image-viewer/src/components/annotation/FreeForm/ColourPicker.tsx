import { useState } from 'react'
import { ColorPicker, toColor } from 'react-colour-palette'
import 'react-colour-palette/dist/index.css'
import { PreDefinedColours } from '../Tools'
import './ColourPicker.css'

interface ColourPickerProps {
  value: string
  onChange: (colour: string) => void
}

function ColourPicker({ value, onChange }: ColourPickerProps) {
  const [customOpen, setCustomOpen] = useState(false)

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
        <button
          type="button"
          className={`colour-picker-swatch colour-picker-swatch--custom${customOpen ? ' colour-picker-swatch--selected' : ''}`}
          style={{ backgroundColor: value }}
          aria-label="Custom colour"
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((open) => !open)}
        />
      </div>

      {customOpen && (
        <div className="colour-picker-custom-panel">
          <ColorPicker
            color={toColor('hex', value)}
            onChange={(next) => onChange(next.hex)}
            width={224}
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
