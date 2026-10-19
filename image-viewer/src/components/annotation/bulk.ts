// annotation-store takes at most this many ids per bulk request (MaxBulkIds
// in Annotations/AnnotationGroupEndpoints.cs). Anything bigger is a 400 and
// nothing changes, so bigger selections go in batches of this size.
const MAX_BULK_IDS = 20_000

function inBatches<T>(items: T[], size = MAX_BULK_IDS): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

export { MAX_BULK_IDS, inBatches }
