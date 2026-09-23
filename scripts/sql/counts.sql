SELECT 'Collections' AS "Table", COUNT(*) AS "Rows" FROM "Collections"
UNION ALL SELECT 'Annotations', COUNT(*) FROM "Annotations"
UNION ALL SELECT 'CellCounts', COUNT(*) FROM "CellCounts"
UNION ALL SELECT 'RegionsOfInterest', COUNT(*) FROM "RegionsOfInterest"
UNION ALL SELECT 'ImageAdjustments', COUNT(*) FROM "ImageAdjustments";

SELECT
    c."SlideId",
    c."UserId",
    (SELECT COUNT(*) FROM "Annotations" a WHERE a."CollectionId" = c."CollectionId") AS "Annotations",
    (SELECT COUNT(*) FROM "Annotations" a WHERE a."CollectionId" = c."CollectionId" AND a."Notes" = 'stress-test') AS "Stress annotations",
    (SELECT COUNT(*) FROM "CellCounts" cc WHERE cc."CollectionId" = c."CollectionId") AS "Cell counts",
    (SELECT COUNT(*) FROM "ImageAdjustments" ia WHERE ia."CollectionId" = c."CollectionId") AS "Adjustment presets"
FROM "Collections" c
ORDER BY c."SlideId", c."UserId";
