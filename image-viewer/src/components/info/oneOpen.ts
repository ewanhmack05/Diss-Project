// Which info box is open, if any - opening one closes whichever was. Kept
// apart from React so it can be tested on its own; InfoNote reads it with
// useSyncExternalStore.
function oneOpen() {
  let open: string | null = null
  const listeners = new Set<() => void>()
  const set = (next: string | null) => {
    if (next === open) return
    open = next
    for (const listener of listeners) listener()
  }
  return {
    current: () => open,
    open: (id: string) => set(id),
    // Only closes it if it's still the open one - a box closing late
    // mustn't close the one opened after it.
    close: (id: string) => {
      if (open === id) set(null)
    },
    toggle: (id: string) => set(open === id ? null : id),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export { oneOpen }
