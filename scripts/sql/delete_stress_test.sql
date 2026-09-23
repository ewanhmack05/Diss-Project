BEGIN;
DELETE FROM "Annotations" WHERE "Notes" = 'stress-test';
DELETE FROM "CellCounts" WHERE "Notes" = 'stress-test';
COMMIT;
