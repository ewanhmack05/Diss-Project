import { useEffect, useState } from 'react'
import { useToolbarContext } from '../../context/ToolbarContext'
import './Toolbar.css'

function AnnotationsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h9l5 5v11H6z" />
      <path d="M14 4v5h5" />
      <line x1="9" y1="13" x2="16" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  )
}

function FullscreenIcon({ active }: { active: boolean }) {
  if (active) {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 4 9 9 4 9" />
        <polyline points="15 4 15 9 20 9" />
        <polyline points="9 20 9 15 4 15" />
        <polyline points="15 20 15 15 20 15" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 9 4 4 9 4" />
      <polyline points="20 9 20 4 15 4" />
      <polyline points="4 15 4 20 9 20" />
      <polyline points="20 15 20 20 15 20" />
    </svg>
  )
}

function Toolbar() {
  const { activeTools, toggleTool } = useToolbarContext()
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="toolbar" data-testid="toolbar">
      <button
        type="button"
        className="toolbar-button"
        title="Toggle fullscreen (F)"
        onClick={toggleFullscreen}
      >
        <FullscreenIcon active={isFullscreen} />
      </button>
      <button
        type="button"
        className={`toolbar-button${activeTools.includes('annotations') ? ' toolbar-button--active' : ''}`}
        title="Annotations"
        onClick={() => toggleTool('annotations')}
      >
        <AnnotationsIcon />
      </button>
    </div>
  )
}

export default Toolbar
