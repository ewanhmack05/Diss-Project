import { useRealtimeContext } from '../../context/RealtimeContext'
import './EditingWith.css'

interface EditingWithProps {
  // Connection ids with the doc open, from useSharedFields.
  editors: string[]
}

// Everyone else who has the same edit form open. Renders nothing when it's
// just you.
function EditingWith({ editors }: EditingWithProps) {
  const { others } = useRealtimeContext()
  const coEditors = others.filter((participant) => editors.includes(participant.connectionId))
  if (coEditors.length === 0) return null

  return (
    <ul className="editing-with" aria-label="Also editing">
      {coEditors.map((participant) => (
        <li key={participant.connectionId} className="editing-with-person">
          <span className="editing-with-dot" style={{ backgroundColor: participant.colour }} />
          {participant.displayName}
        </li>
      ))}
    </ul>
  )
}

export default EditingWith
