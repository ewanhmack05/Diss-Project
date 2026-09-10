import { useEffect, useState } from 'react'
import { useToolbarContext } from '../../context/ToolbarContext'
import annotationsIconSvg from '../../icons/annotations.svg?raw'
import fullscreenEnterIconSvg from '../../icons/fullscreen-enter.svg?raw'
import fullscreenExitIconSvg from '../../icons/fullscreen-exit.svg?raw'
import './Toolbar.css'

// Global shortcuts (like F for fullscreen) shouldn't fire while the user is
// typing somewhere - e.g. "f" in an annotation's label or notes field.
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return TYPING_TAGS.has(target.tagName) || target.isContentEditable
}

function Icon({ svg }: { svg: string }) {
  return <span className="toolbar-icon" dangerouslySetInnerHTML={{ __html: svg }} />
}

type ToolName = 'fullscreen' | 'annotations'

const DEFAULT_TOOLS: ToolName[] = ['fullscreen', 'annotations']

interface ToolbarProps {
  tools?: ToolName[]
}

function Toolbar({ tools = DEFAULT_TOOLS }: ToolbarProps) {
  const { activeTools, toggleTool } = useToolbarContext()
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { })
    } else {
      document.documentElement.requestFullscreen().catch(() => { })
    }
  }

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    if (!tools.includes('fullscreen')) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return
      if (isTypingTarget(e.target)) return
      toggleFullscreen()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tools])

  return (
    <div className="toolbar" data-testid="toolbar">
      {tools.includes('fullscreen') && (
        <button
          type="button"
          className="toolbar-button"
          title="Toggle fullscreen (F)"
          onClick={toggleFullscreen}
        >
          <Icon svg={isFullscreen ? fullscreenExitIconSvg : fullscreenEnterIconSvg} />
        </button>
      )}
      {tools.includes('annotations') && (
        <button
          type="button"
          className={`toolbar-button${activeTools.includes('annotations') ? ' toolbar-button--active' : ''}`}
          title="Annotations"
          onClick={() => toggleTool('annotations')}
        >
          <Icon svg={annotationsIconSvg} />
        </button>
      )}
    </div>
  )
}

export default Toolbar
export type { ToolName }
