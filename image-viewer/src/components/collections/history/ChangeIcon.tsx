import type { ChangeKind } from './history'

// Outline shapes on a 16 grid, drawn in currentColor.
const PATHS: Record<ChangeKind, string> = {
  add: 'M8 3 V13 M3 8 H13',
  change: 'M10.5 2.5 L13.5 5.5 L5.5 13.5 H2.5 V10.5 Z M9 4 L12 7',
  delete: 'M2.5 4.5 H13.5 M6 4.5 V2.5 H10 V4.5 M4 4.5 L4.8 13.5 H11.2 L12 4.5 M6.8 7 V11 M9.2 7 V11',
  merge: 'M4 2.5 V6 C4 8 8 8 8 10 V13.5 M12 2.5 V6 C12 8 8 8 8 10 M5.5 12 L8 14 L10.5 12',
  import: 'M8 2.5 V9.5 M5 6.5 L8 9.5 L11 6.5 M2.5 10 V13.5 H13.5 V10',
  restore: 'M5.5 3 L2.5 6 L5.5 9 M2.5 6 H10 A3.5 3.5 0 0 1 10 13 H7',
}

function ChangeIcon({ kind, className }: { kind: ChangeKind; className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={PATHS[kind]} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default ChangeIcon
