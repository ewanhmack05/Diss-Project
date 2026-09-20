import { useEffect } from 'react'
import { useBotControlContext } from '../../context/BotControlContext'
import { useImageViewerContext } from '../../context/ImageViewerContext'
import './ConnectomeControls.css'

// Rounds a [0,1] fraction to a whole percent for the status readout below -
// purely a display nicety, not anything the bot itself sees (see
// open-layers/workingArea.ts for the actual region math).
function toPercent(fraction: number): number {
  return Math.round(fraction * 100)
}

function describeRegion(region: { x: number; y: number; width: number; height: number }): string {
  const xFrom = toPercent(region.x)
  const xTo = toPercent(region.x + region.width)
  const yFrom = toPercent(region.y)
  const yTo = toPercent(region.y + region.height)
  return `x ${xFrom}–${xTo}%, y ${yFrom}–${yTo}%`
}

// The bot's live controls (see BotControlContext) - two independent on/off
// switches for what it draws on the slide, plus the working-area box that
// constrains where all of it (annotations, cell-count dots, and pathway line
// endpoints alike) is allowed to land. Pathway *wiring* itself is never
// gated here - it always runs, since it's what drives the 3D view above.
function ConnectomeControls() {
  const {
    status,
    annotationsEnabled,
    cellCountEnabled,
    region,
    pendingAction,
    lastActionError,
    drawingWorkingArea,
    botSlideId,
    setAnnotationsEnabled,
    setCellCountEnabled,
    setRegion,
    startDrawingWorkingArea,
    stopDrawingWorkingArea,
    retryLoad,
  } = useBotControlContext()
  const { source } = useImageViewerContext()
  const { slideId: viewerSlideId } = source

  // Closing the panel mid-draw (the toolbar button, not this component's own
  // Cancel) unmounts this without ever calling stopDrawingWorkingArea itself
  // - without this, MapNode's Draw interaction would stay attached with no
  // control left on screen to turn it back off. Empty deps deliberately:
  // this only needs whichever stopDrawingWorkingArea closure existed at
  // mount, since it just calls the provider's stable setState setter either
  // way (see BotControlContext).
  useEffect(() => {
    return () => stopDrawingWorkingArea()
  }, [])

  if (status === 'loading') {
    return <div className="connectome-controls connectome-controls--message">Loading bot controls…</div>
  }

  if (status === 'error') {
    return (
      <div className="connectome-controls connectome-controls--message">
        <p>Couldn't reach the bot control service.</p>
        <button type="button" className="connectome-controls-retry" onClick={retryLoad}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="connectome-controls">
      <div className="connectome-controls-row">
        <label className="connectome-controls-switch">
          <input
            type="checkbox"
            checked={annotationsEnabled}
            disabled={pendingAction === 'annotations'}
            onChange={(e) => setAnnotationsEnabled(e.target.checked)}
          />
          {annotationsEnabled ? 'Stop Annotations' : 'Start Annotations'}
        </label>
        <label className="connectome-controls-switch">
          <input
            type="checkbox"
            checked={cellCountEnabled}
            disabled={pendingAction === 'cellCount'}
            onChange={(e) => setCellCountEnabled(e.target.checked)}
          />
          {cellCountEnabled ? 'Stop Cell Counter' : 'Start Cell Counter'}
        </label>
      </div>

      <div className="connectome-controls-row">
        <button
          type="button"
          className={`connectome-controls-button${drawingWorkingArea ? ' connectome-controls-button--active' : ''}`}
          onClick={() => (drawingWorkingArea ? stopDrawingWorkingArea() : startDrawingWorkingArea())}
        >
          {drawingWorkingArea ? 'Cancel Drawing' : 'Draw Working Area'}
        </button>
        <button
          type="button"
          className="connectome-controls-button"
          disabled={!region || pendingAction === 'region'}
          onClick={() => setRegion(null)}
        >
          Clear Working Area
        </button>
      </div>

      <p className="connectome-controls-status">
        {region ? `Working area: ${describeRegion(region)}` : 'Working area: full slide'}
      </p>

      {drawingWorkingArea && (
        <p className="connectome-controls-hint">Drag a rectangle on the slide to set the bot's working area.</p>
      )}

      {botSlideId !== null && botSlideId !== viewerSlideId && (
        <p className="connectome-controls-error">
          Bot is writing into slide "{botSlideId}", this tab has "{viewerSlideId}" open - annotations and cell
          counts won't show up here until they match.
        </p>
      )}

      {lastActionError && <p className="connectome-controls-error">{lastActionError}</p>}
    </div>
  )
}

export default ConnectomeControls
