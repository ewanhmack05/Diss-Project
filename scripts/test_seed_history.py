"""Tests for seed_history.py's parts that don't need anything running.

    python -m unittest discover -s scripts
"""
import os
import tempfile
import unittest
from datetime import UTC, datetime

from seed_history import PEOPLE, STORY, backdate_sql, check_story, connection

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)


class Story(unittest.TestCase):
    def test_the_story_is_oldest_first_and_only_the_sessions_people(self):
        self.assertIsNone(check_story(STORY))

    def test_out_of_order_or_two_at_once_is_refused(self):
        self.assertIn("oldest first", check_story([(5, "alice", "x"), (10, "bob", "y")]))
        self.assertIn("oldest first", check_story([(5, "alice", "x"), (5, "bob", "y")]))

    def test_someone_not_in_the_session_is_refused(self):
        self.assertIn("dave", check_story([(5, "dave", "x")]))

    def test_everyone_in_the_session_does_something(self):
        self.assertEqual(set(PEOPLE), {who for _, who, _ in STORY})

    def test_some_deletes_are_left_to_put_back(self):
        kinds = [kind for _, _, kind in STORY]
        self.assertIn("bulk delete and keep", kinds)
        self.assertIn("delete cell count", kinds)
        # The one bulk delete that's put back comes straight before its restore.
        self.assertEqual(kinds.index("restore"), kinds.index("bulk delete") + 1)


class BackdateSql(unittest.TestCase):
    def sql(self):
        return backdate_sql(
            NOW,
            "c-1",
            [("cs-old", 110.0), ("cs-new", 1.5)],
            {"Annotations": [("Id", "a-1", 110.0)], "AnnotationGroups": [], "CellCounts": [("Id", "cc-1", 1.5)]},
            ["host-id", "bob-id"],
        )

    def test_is_one_transaction(self):
        sql = self.sql()
        self.assertTrue(sql.startswith("BEGIN;"))
        self.assertTrue(sql.rstrip().endswith("COMMIT;"))

    def test_moves_each_change_set_back_by_its_hours(self):
        sql = self.sql()
        self.assertIn('UPDATE "ChangeSets" SET "Created" = \'2026-10-16T22:00:00+00:00\'::timestamptz WHERE "Id" = \'cs-old\';', sql)
        self.assertIn('UPDATE "ChangeSets" SET "Created" = \'2026-10-21T10:30:00+00:00\'::timestamptz WHERE "Id" = \'cs-new\';', sql)

    def test_moves_the_rows_made_back_with_them(self):
        sql = self.sql()
        self.assertIn('UPDATE "Annotations" SET "Created" = \'2026-10-16T22:00:00+00:00\'::timestamptz WHERE "Id" = \'a-1\';', sql)
        self.assertIn('UPDATE "CellCounts" SET "Created" = \'2026-10-21T10:30:00+00:00\'::timestamptz WHERE "Id" = \'cc-1\';', sql)

    def test_the_session_and_its_people_come_before_the_first_change(self):
        sql = self.sql()
        # An hour before the oldest change, and the others half an hour after the host.
        self.assertIn('UPDATE "Collections" SET "Created" = \'2026-10-16T21:00:00+00:00\'::timestamptz', sql)
        self.assertIn('"Added" = \'2026-10-16T21:30:00+00:00\'::timestamptz WHERE "CollectionId" = \'c-1\' AND "UserId" = \'bob-id\'', sql)

    def test_deleted_rows_take_their_deleting_changes_time_in_this_collection_only(self):
        sql = self.sql()
        for table in ("Annotations", "AnnotationGroups", "CellCounts"):
            self.assertIn(f'UPDATE "{table}" t SET "Deleted" = c."Created" FROM "ChangeSets" c '
                          f'WHERE t."DeletedIn" = c."Id" AND t."CollectionId" = \'c-1\';', sql)


class Connection(unittest.TestCase):
    def test_reads_annotation_stores_connection_string(self):
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as env:
            env.write("OTHER=1\nConnectionStrings__AnnotationStore=Host=db;Port=5433;Database=annotationtest;Username=me;Password=p=w;\n")
        try:
            args, password = connection(env.name)
        finally:
            os.unlink(env.name)
        self.assertEqual(["-h", "db", "-p", "5433", "-d", "annotationtest", "-U", "me"], args)
        # Only the first = splits a pair, so a password can have one in it.
        self.assertEqual("p=w", password)

    def test_says_so_when_theres_no_connection_string(self):
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as env:
            env.write("OTHER=1\n")
        try:
            with self.assertRaises(SystemExit):
                connection(env.name)
        finally:
            os.unlink(env.name)


if __name__ == "__main__":
    unittest.main()
