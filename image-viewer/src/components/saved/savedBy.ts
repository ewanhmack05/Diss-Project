// Who saved something, as the saved lists show it - "You" for your own,
// their name otherwise, and nothing for things from before sign-in.
function savedBy(item: { createdById?: string; createdByName?: string }, myId: string): string | null {
  if (!item.createdById) return null
  if (item.createdById === myId) return 'You'
  return item.createdByName || null
}

export { savedBy }
