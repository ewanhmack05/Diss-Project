import { useEffect, useRef } from 'react'
import { useDialogContext, type DialogAction } from '../../context/DialogContext'
import './DialogHost.css'

function DialogHost() {
  const { current, closeDialog } = useDialogContext()
  const firstButton = useRef<HTMLButtonElement>(null)

  const run = (action: DialogAction) => {
    if (!current) return
    closeDialog(current.id)
    action.onClick?.()
  }

  useEffect(() => {
    if (!current) return
    firstButton.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeDialog(current.id)
      current.actions[current.actions.length - 1].onClick?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [current, closeDialog])

  if (!current) return null

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${current.id}-title`}
        aria-describedby={`${current.id}-message`}
      >
        <h2 id={`${current.id}-title`} className="dialog-title">
          {current.title}
        </h2>
        <p id={`${current.id}-message`} className="dialog-message">
          {current.message}
        </p>
        <div className="dialog-actions">
          {current.actions.map((action, i) => (
            <button
              key={action.label}
              ref={i === 0 ? firstButton : undefined}
              type="button"
              className={`dialog-button${action.variant ? ` dialog-button--${action.variant}` : ''}`}
              onClick={() => run(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default DialogHost
