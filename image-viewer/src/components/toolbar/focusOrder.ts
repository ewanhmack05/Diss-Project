// Which panel (or, for a split dock edge, which edge as a whole - see
// App.tsx's stacking-key resolution) was interacted with last renders on
// top - mirrors how OS windows work: click anywhere on one and it comes
// forward, no manual z-index juggling. `order` runs back-to-front, so the
// most recently brought-forward key is always last.
function bringToFront(order: string[], key: string): string[] {
  return [...order.filter((existing) => existing !== key), key]
}

// How far forward `key` is, for turning into a z-index. Never-focused keys
// (not in `order`) sit at the back, same as everything else that's never
// been focused - not behind them.
function stackIndex(order: string[], key: string): number {
  return Math.max(0, order.indexOf(key))
}

export { bringToFront, stackIndex }
