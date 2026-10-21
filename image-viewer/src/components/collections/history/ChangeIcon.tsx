import Icon from '../../../icons/Icon'
import addSvg from '../../../icons/changes/add.svg?raw'
import changeSvg from '../../../icons/changes/change.svg?raw'
import deleteSvg from '../../../icons/changes/delete.svg?raw'
import importSvg from '../../../icons/changes/import.svg?raw'
import mergeSvg from '../../../icons/changes/merge.svg?raw'
import restoreSvg from '../../../icons/changes/restore.svg?raw'
import type { ChangeKind } from './history'

const ICONS: Record<ChangeKind, string> = {
  add: addSvg,
  change: changeSvg,
  delete: deleteSvg,
  merge: mergeSvg,
  import: importSvg,
  restore: restoreSvg,
}

function ChangeIcon({ kind, className }: { kind: ChangeKind; className?: string }) {
  return <Icon svg={ICONS[kind]} size={16} className={className} />
}

export default ChangeIcon
