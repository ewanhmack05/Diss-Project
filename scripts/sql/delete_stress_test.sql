-- What seed_stress.py added, and the copies clean_stress.py's deletes left
-- in the history - those are whole rows, so a big run can be a lot of it.
BEGIN;
DELETE FROM "Annotations" WHERE "Notes" = 'stress-test';
DELETE FROM "CellCounts" WHERE "Notes" = 'stress-test';
DELETE FROM history."Entries" WHERE "Before" ->> 'Notes' = 'stress-test';
COMMIT;
