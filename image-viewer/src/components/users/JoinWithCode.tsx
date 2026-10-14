import { useState } from 'react'
import { useInviteGate } from '../realtime/InviteGate'
import { inviteCodeFrom } from './presence'
import './Users.css'

// Typing or pasting an invite code - or a whole link - instead of opening
// the link. Brings up the same invite card the link would.
function JoinWithCode() {
  const { openInvite } = useInviteGate()
  const [text, setText] = useState('')
  const [wrong, setWrong] = useState(false)

  const submit = () => {
    const code = inviteCodeFrom(text)
    if (!code) {
      setWrong(true)
      return
    }
    setText('')
    setWrong(false)
    openInvite(code)
  }

  return (
    <section className="realtime-section">
      <h3 className="realtime-heading">Join with a code</h3>
      <form
        className="realtime-invite-link"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          type="text"
          aria-label="Invite code"
          aria-invalid={wrong}
          aria-describedby={wrong ? 'join-code-wrong' : undefined}
          placeholder="Code, or the whole link"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setWrong(false)
          }}
        />
        <button type="submit" className="realtime-button realtime-button--accent" disabled={!text.trim()}>
          Join
        </button>
      </form>
    </section>
  )
}

export default JoinWithCode
