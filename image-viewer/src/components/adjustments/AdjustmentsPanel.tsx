import { useState, type ChangeEvent } from 'react'
import { useAdjustmentsContext } from '../../context/AdjustmentsContext'
import DockedCard from '../toolbar/DockedCard'
import type { ImageAdjustmentValues } from './adjustments'
import './AdjustmentsPanel.css'

interface SliderField {
  key: keyof ImageAdjustmentValues
  label: string
  min: number
  max: number
}

const SLIDER_FIELDS: SliderField[] = [
  { key: 'brightness', label: 'Brightness', min: -1, max: 1 },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1 },
  { key: 'gamma', label: 'Gamma', min: 0.1, max: 3 },
  { key: 'red', label: 'Red', min: 0, max: 2 },
  { key: 'green', label: 'Green', min: 0, max: 2 },
  { key: 'blue', label: 'Blue', min: 0, max: 2 },
]

function AdjustmentsPanel() {
  const { values, setValues, resetValues, presets, status, savePreset, applyPreset, updatePreset, deletePreset } =
    useAdjustmentsContext()
  const [presetName, setPresetName] = useState('')

  const handleSliderChange = (key: keyof ImageAdjustmentValues) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value)
    if (Number.isFinite(value)) {
      setValues({ ...values, [key]: value })
    }
  }

  const handleSave = () => {
    const trimmed = presetName.trim()
    if (!trimmed) return
    savePreset(trimmed)
    setPresetName('')
  }

  return (
    <div className="adjustments-panel">
      <DockedCard title="Adjustments" className="adjustments-panel-sliders-card">
        {SLIDER_FIELDS.map(({ key, label, min, max }) => (
          <label key={key} className="adjustments-panel-slider">
            <span className="adjustments-panel-slider-header">
              <span>{label}</span>
              <span className="adjustments-panel-slider-value">{values[key].toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={0.01}
              value={values[key]}
              onChange={handleSliderChange(key)}
            />
          </label>
        ))}
        <button type="button" className="adjustments-panel-reset" onClick={resetValues}>
          Reset
        </button>
      </DockedCard>

      <DockedCard title="Presets" className="adjustments-panel-presets-card">
        <div className="adjustments-panel-save-row">
          <input
            type="text"
            className="adjustments-panel-name-input"
            value={presetName}
            maxLength={64}
            placeholder="Preset name"
            onChange={(e) => setPresetName(e.target.value)}
          />
          <button
            type="button"
            className="adjustments-panel-save-button"
            disabled={!presetName.trim()}
            onClick={handleSave}
          >
            Save
          </button>
        </div>

        {status === 'loading' && <p className="adjustments-panel-presets-empty">Loading...</p>}
        {status === 'error' && (
          <p className="adjustments-panel-presets-empty">Couldn't reach the annotation store.</p>
        )}
        {status === 'ready' && presets.length === 0 && (
          <p className="adjustments-panel-presets-empty">Nothing saved yet.</p>
        )}
        {status === 'ready' && presets.length > 0 && (
          <ul className="adjustments-panel-preset-list themed-scroll">
            {presets.map((preset) => (
              <li key={preset.imageAdjustmentId} className="adjustments-panel-preset-row">
                <span className="adjustments-panel-preset-name">{preset.adjustmentName}</span>
                <div className="adjustments-panel-preset-actions">
                  <button type="button" onClick={() => applyPreset(preset.imageAdjustmentId)}>
                    Apply
                  </button>
                  <button type="button" onClick={() => updatePreset(preset.imageAdjustmentId)}>
                    Update
                  </button>
                  <button
                    type="button"
                    className="adjustments-panel-preset-delete"
                    onClick={() => deletePreset(preset.imageAdjustmentId)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DockedCard>
    </div>
  )
}

export default AdjustmentsPanel
