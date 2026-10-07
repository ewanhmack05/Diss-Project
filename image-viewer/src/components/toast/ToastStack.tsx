import { useToastContext } from '../../context/ToastContext'
import './ToastStack.css'

function ToastStack() {
  const { toasts, removeToast } = useToastContext()

  if (toasts.length === 0) return null

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.variant}`} role="status">
          <span className="toast-message">{toast.message}</span>
          {toast.actions.length > 0 && (
            <div className="toast-actions">
              {toast.actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={`toast-action${action.primary ? ' toast-action--primary' : ''}`}
                  onClick={() => {
                    removeToast(toast.id)
                    action.onClick?.()
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss"
            onClick={() => removeToast(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export default ToastStack
