-- Deleted rows are only hidden by annotation-store, so they're still counted
-- in Rows - Deleted says how many of them that is.
SELECT 'Collections' AS "Table", COUNT(*) AS "Rows", COUNT("Deleted") AS "Deleted" FROM "Collections"
UNION ALL SELECT 'Annotations', COUNT(*), COUNT("Deleted") FROM "Annotations"
UNION ALL SELECT 'AnnotationGroups', COUNT(*), COUNT("Deleted") FROM "AnnotationGroups"
UNION ALL SELECT 'CellCounts', COUNT(*), COUNT("Deleted") FROM "CellCounts"
UNION ALL SELECT 'RegionsOfInterest', COUNT(*), NULL FROM "RegionsOfInterest"
UNION ALL SELECT 'ImageAdjustments', COUNT(*), COUNT("Deleted") FROM "ImageAdjustments"
UNION ALL SELECT 'ChangeSets', COUNT(*), NULL FROM "ChangeSets";

SELECT
    c."SlideId",
    c."UserId",
    (SELECT COUNT(*) FROM "Annotations" a WHERE a."CollectionId" = c."CollectionId") AS "Annotations",
    (SELECT COUNT(*) FROM "Annotations" a WHERE a."CollectionId" = c."CollectionId" AND a."Notes" = 'stress-test') AS "Stress annotations",
    (SELECT COUNT(*) FROM "CellCounts" cc WHERE cc."CollectionId" = c."CollectionId") AS "Cell counts",
    (SELECT COUNT(*) FROM "ImageAdjustments" ia WHERE ia."CollectionId" = c."CollectionId") AS "Adjustment presets"
FROM "Collections" c
ORDER BY c."SlideId", c."UserId";
