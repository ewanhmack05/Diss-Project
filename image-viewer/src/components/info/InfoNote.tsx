import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { computePopupPosition, type Position } from '../colour-picker/popupPosition'
import Icon from '../../icons/Icon'
import infoSvg from '../../icons/info.svg?raw'
import { oneOpen } from './oneOpen'
import './InfoNote.css'

// One open at a time, across the whole viewer.
const boxes = oneOpen()

interface InfoNoteProps {
  // What it explains, for the button's name - "About navigation".
  label: string
  children: ReactNode
}

// An (i) button that opens a small box of explanation beside it - for how
// something works, kept out of the way of what you do with it. Anything you
// need before acting stays on the page instead.
//
// The box is a fixed-position portal like the colour picker's: a docked
// panel clips anything that spills out of it. It closes on a press outside,
// Esc (back to the button), a scroll, or another box opening.
function InfoNote({ label, children }: InfoNoteProps) {
  const id = useId()
  const open = useSyncExternalStore(boxes.subscribe, () => boxes.current() === id)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<Position | null>(null)

  // Measured off screen first, then placed before the browser paints.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const button = buttonRef.current
    const box = boxRef.current
    if (!button || !box) return
    // Out on <body>, so it takes the viewer's text size from the app -
    // the fontSize option is set there - before it's measured.
    const app = button.closest('.app')
    if (app) box.style.fontSize = getComputedStyle(app).fontSize
    setPosition(
      computePopupPosition(
        button.getBoundingClientRect(),
        { width: box.offsetWidth, height: box.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => boxes.close(id)
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || boxRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
      buttonRef.current?.focus()
    }
    // Fixed in place, so it would float off whatever it's about.
    const onScroll = (event: Event) => {
      if (!boxRef.current?.contains(event.target as Node)) close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open, id])

  // Gone from the page while open - nothing else would close it.
  useEffect(() => () => boxes.close(id), [id])

  const style: CSSProperties = position
    ? { top: position.top, left: position.left, visibility: 'visible' }
    : { top: 0, left: 0, visibility: 'hidden' }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`info-note-button${open ? ' info-note-button--open' : ''}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => boxes.toggle(id)}
      >
        <Icon svg={infoSvg} size={13} />
      </button>
      {open &&
        createPortal(
          <div ref={boxRef} id={id} role="dialog" aria-label={label} className="info-note-box" style={style}>
            {children}
          </div>,
          document.body
        )}
    </>
  )
}

export default InfoNote
