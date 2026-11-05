import { useState } from 'react'
import { useImageViewerContext } from '../../context/ImageViewerContext'
import { useToastContext } from '../../context/ToastContext'
import { formatShortDate } from '../saved/savedDates'
import { useInviteGate } from '../realtime/InviteGate'
import { attachmentNoun, formatBytes, type Attachment, type Message } from './messages'
import { useSentThings } from './useSentThings'

interface AttachmentCardProps {
  message: Message
  attachment: Attachment
  // You sent it, so it's yours already - adding it would only be a duplicate.
  mine: boolean
  onChanged: (attachment: Attachment) => void
}

// Something sent in a message: what it is, and adding it to your own collection
// as a copy. An invite opens the same preview as a link, which already says if
// it's stopped, run out or for another slide.
function AttachmentCard({ message, attachment, mine, onChanged }: AttachmentCardProps) {
  const { addToMine } = useSentThings()
  const { openInvite } = useInviteGate()
  const { source } = useImageViewerContext()
  const { addToast } = useToastContext()
  const [adding, setAdding] = useState(false)

  const elsewhere = !!attachment.slideId && attachment.slideId !== source.slideId
  const add = () => {
    setAdding(true)
    addToMine(message)
      .then((updated) => {
        onChanged(updated)
        addToast(elsewhere ? `Added to your collection for slide ${attachment.slideId}` : 'Added to your collection', 'success')
      })
      .catch((error: Error) => addToast(error.message || "Couldn't add that - nothing was added", 'error'))
      .finally(() => setAdding(false))
  }

  return (
    <div className="messages-card">
      <span className="messages-card-kind">{attachmentNoun(attachment.kind)}</span>
      <span className="messages-card-name" title={attachment.name}>
        {attachment.name}
      </span>
      {attachment.kind === 'invite' ? (
        attachment.inviteCode && !mine && (
          <button type="button" className="messages-button messages-button--accent" onClick={() => openInvite(attachment.inviteCode!)}>
            Have a look
          </button>
        )
      ) : (
        <>
          <span className="messages-card-meta">{formatBytes(attachment.bytes)}</span>
          {elsewhere && <span className="messages-card-meta">From slide {attachment.slideId}, so you won't see it from here</span>}
          {attachment.lastAddedByMe && <span className="messages-card-meta">Added {formatShortDate(attachment.lastAddedByMe)}</span>}
          {!mine && (
            <button type="button" className="messages-button messages-button--accent" disabled={adding} onClick={add}>
              {adding ? 'Adding…' : attachment.lastAddedByMe ? 'Add again' : 'Add to my collection'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default AttachmentCard
