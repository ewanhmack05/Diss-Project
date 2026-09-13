import type { ImageAdjustmentValues } from '../components/adjustments/adjustments'

interface ImageAdjustmentPreset {
  imageAdjustmentId: string
  collectionId: string
  adjustmentName: string
  adjustments: string
  created: string
}

export type { ImageAdjustmentPreset, ImageAdjustmentValues }
