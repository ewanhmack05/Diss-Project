import { useEffect } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { useDialogContext } from '../../context/DialogContext'
import { useEmitEvent } from '../../context/EventContext'
import { useRealtimeContext } from '../../context/RealtimeContext'

// The host asked a guest to edit. Guests can only look, since anything they
// added would be saved with their name - so it's an account first, then back
// through the same link, and the host lets them edit from there.
function GuestEditPrompt() {
  const { user, signIn } = useAuthContext()
  const { onRequest } = useRealtimeContext()
  const { showDialog } = useDialogContext()
  const emit = useEmitEvent()
  const isGuest = !!user.guest

  useEffect(() => {
    if (!isGuest) return
    return onRequest((request) => {
      if (request.kind !== 'edit') return
      emit('guest:asked-to-edit', { from: request.fromConnectionId })
      showDialog({
        title: `${request.fromName} would like you to edit`,
        message:
          "Guests can only look. Make an account, or sign in, and you'll come back to this session - then they can let you edit.",
        actions: [
          { label: 'Make an account', variant: 'accent', onClick: () => signIn(true) },
          { label: 'Sign in', onClick: () => signIn(false) },
          { label: 'Not now' },
        ],
      })
    })
  }, [isGuest, onRequest, showDialog, signIn, emit])

  return null
}

export default GuestEditPrompt
