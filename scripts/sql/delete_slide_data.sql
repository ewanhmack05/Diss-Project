BEGIN;
DELETE FROM "Annotations" WHERE "SlideId" = '003';
DELETE FROM "CellCounts" WHERE "SlideId" = '003';
DELETE FROM "ImageAdjustments" WHERE "SlideId" = '003';
COMMIT;
