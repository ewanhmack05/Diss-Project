-- The live tables only hold what's there now. Deleted rows are in the
-- history schema - a deleted collection is the one thing still in its table,
-- hidden, so Deleted says how many of those there are.
SELECT 'Collections' AS "Table", COUNT(*) AS "Rows", COUNT("Deleted") AS "Deleted" FROM "Collections"
UNION ALL SELECT 'Annotations', COUNT(*), NULL FROM "Annotations"
UNION ALL SELECT 'AnnotationGroups', COUNT(*), NULL FROM "AnnotationGroups"
UNION ALL SELECT 'CellCounts', COUNT(*), NULL FROM "CellCounts"
UNION ALL SELECT 'RegionsOfInterest', COUNT(*), NULL FROM "RegionsOfInterest"
UNION ALL SELECT 'ImageAdjustments', COUNT(*), NULL FROM "ImageAdjustments"
UNION ALL SELECT 'history.ChangeSets', COUNT(*), NULL FROM history."ChangeSets"
UNION ALL SELECT 'history.Entries', COUNT(*), COUNT(*) FILTER (WHERE "Op" = 'Delete') FROM history."Entries";

SELECT
    c."SlideId",
    c."UserId",
    (SELECT COUNT(*) FROM "Annotations" a WHERE a."CollectionId" = c."CollectionId") AS "Annotations",
    (SELECT COUNT(*) FROM "Annotations" a WHERE a."CollectionId" = c."CollectionId" AND a."Notes" = 'stress-test') AS "Stress annotations",
    (SELECT COUNT(*) FROM "CellCounts" cc WHERE cc."CollectionId" = c."CollectionId") AS "Cell counts",
    (SELECT COUNT(*) FROM "ImageAdjustments" ia WHERE ia."CollectionId" = c."CollectionId") AS "Adjustment presets"
FROM "Collections" c
ORDER BY c."SlideId", c."UserId";
