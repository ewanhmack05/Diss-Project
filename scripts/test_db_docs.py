"""Tests for db_docs.py, and that annotation-store's README matches the schema.

    python -m unittest discover -s scripts
"""
import json
import unittest

from db_docs import (
    END,
    NOTES,
    README,
    SNAPSHOT,
    START,
    diagram,
    generate,
    parse_snapshot,
    problems,
    replace_section,
    table_section,
)

SAMPLE = """
            modelBuilder.Entity("App.Parent", b =>
                {
                    b.Property<Guid>("Id")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("uuid");

                    b.Property<string>("Name")
                        .IsRequired()
                        .HasColumnType("text");

                    b.Property<DateTimeOffset?>("Gone")
                        .HasColumnType("timestamp with time zone");

                    b.HasKey("Id");

                    b.HasIndex("Name", "Gone")
                        .IsUnique()
                        .HasFilter("\\"Gone\\" IS NULL");

                    b.ToTable("Parents");
                });

            modelBuilder.Entity("App.Child", b =>
                {
                    b.Property<long>("Id")
                        .HasColumnType("bigint");

                    b.Property<Guid>("ParentId")
                        .HasColumnType("uuid");

                    b.Property<Guid?>("OtherId")
                        .HasColumnType("uuid");

                    b.Property<string>("Maybe")
                        .HasColumnType("jsonb");

                    b.HasKey("Id");

                    b.ToTable("Children", "history");
                });

            modelBuilder.Entity("App.Child", b =>
                {
                    b.HasOne("App.Parent", null)
                        .WithMany()
                        .HasForeignKey("ParentId")
                        .OnDelete(DeleteBehavior.Cascade)
                        .IsRequired();

                    b.HasOne("App.Parent", null)
                        .WithOne("Other")
                        .HasForeignKey("App.Child", "OtherId")
                        .OnDelete(DeleteBehavior.SetNull);
                });

            modelBuilder.Entity("App.Parent", b =>
                {
                    b.Navigation("Other");
                });
"""


def note_for(columns):
    return {"summary": "What it is.", "make": "Like this.", "columns": {c: ["server", f"About {c}"] for c in columns}}


SAMPLE_NOTES = {"Parents": note_for(["Id", "Name", "Gone"]), "history.Children": note_for(["Id", "ParentId", "OtherId", "Maybe"])}


class ParseSnapshot(unittest.TestCase):
    def setUp(self):
        self.tables, self.relations = parse_snapshot(SAMPLE)

    def test_names_tables_with_their_schema(self):
        self.assertEqual({"Parents", "history.Children"}, set(self.tables))

    def test_reads_columns_and_what_can_be_null(self):
        columns = {c["name"]: c for c in self.tables["Parents"]["columns"]}
        self.assertEqual("timestamp with time zone", columns["Gone"]["type"])
        self.assertTrue(columns["Gone"]["nullable"])
        self.assertFalse(columns["Name"]["nullable"])

    def test_a_string_without_is_required_can_be_null(self):
        columns = {c["name"]: c for c in self.tables["history.Children"]["columns"]}
        self.assertTrue(columns["Maybe"]["nullable"])

    def test_a_key_is_never_null_even_as_a_string_without_is_required(self):
        tables, _ = parse_snapshot("""
            modelBuilder.Entity("App.Invite", b =>
                {
                    b.Property<string>("Code")
                        .HasColumnType("text");

                    b.HasKey("Code");

                    b.ToTable("Invites");
                });
""")
        self.assertFalse(tables["Invites"]["columns"][0]["nullable"])

    def test_reads_keys_and_filtered_unique_indexes(self):
        self.assertEqual(["Id"], self.tables["Parents"]["key"])
        index = self.tables["Parents"]["indexes"][0]
        self.assertEqual((["Name", "Gone"], True, '"Gone" IS NULL'), (index["columns"], index["unique"], index["filter"]))

    def test_reads_both_kinds_of_relationship(self):
        by_column = {r["column"]: r for r in self.relations}
        self.assertEqual(("Parents", "history.Children", False, True, "cascade"),
                         tuple(by_column["ParentId"][k] for k in ("from", "to", "one_to_one", "required", "on_delete")))
        self.assertEqual((True, False, "set null"), tuple(by_column["OtherId"][k] for k in ("one_to_one", "required", "on_delete")))


class Diagram(unittest.TestCase):
    def setUp(self):
        self.tables, self.relations = parse_snapshot(SAMPLE)
        self.text = diagram(self.tables, self.relations, ["Parents", "history.Children"])

    def test_is_a_mermaid_er_diagram(self):
        self.assertTrue(self.text.startswith("```mermaid\nerDiagram\n"))
        self.assertTrue(self.text.endswith("```"))

    def test_marks_keys_and_nulls_with_types_it_can_draw(self):
        self.assertIn("uuid Id PK", self.text)
        self.assertIn("uuid ParentId FK", self.text)
        self.assertIn('timestamptz Gone "null"', self.text)

    def test_quotes_a_name_with_a_schema_and_draws_cardinality(self):
        self.assertIn('"Parents" ||--o{ "history.Children" : "ParentId, cascade"', self.text)
        self.assertIn('"Parents" |o--o| "history.Children" : "OtherId, set null"', self.text)


class TableSection(unittest.TestCase):
    def test_says_what_it_is_how_to_make_one_and_every_column(self):
        tables, relations = parse_snapshot(SAMPLE)
        text = table_section("history.Children", tables["history.Children"], relations, SAMPLE_NOTES["history.Children"])
        self.assertIn("### history.Children", text)
        self.assertIn("**To make one:** Like this.", text)
        self.assertIn("| `Maybe` | jsonb, null |  | server | About Maybe |", text)
        self.assertIn("| `ParentId` | uuid | FK | server |", text)
        self.assertIn("`ParentId` points at `Parents`, cascade when that's deleted", text)


class Problems(unittest.TestCase):
    def setUp(self):
        self.tables, _ = parse_snapshot(SAMPLE)

    def test_nothing_when_they_match(self):
        self.assertEqual([], problems(self.tables, SAMPLE_NOTES))

    def test_a_new_column_or_table_with_no_note(self):
        notes = {"Parents": note_for(["Id", "Name"])}
        self.assertIn("Parents.Gone has no note", problems(self.tables, notes))
        self.assertIn("history.Children is in the schema but has no note", problems(self.tables, notes))

    def test_a_note_for_something_thats_gone(self):
        notes = {**SAMPLE_NOTES, "Old": note_for([]), "Parents": note_for(["Id", "Name", "Gone", "Dropped"])}
        self.assertIn("Old has a note but isn't in the schema", problems(self.tables, notes))
        self.assertIn("Parents.Dropped has a note but isn't a column", problems(self.tables, notes))

    def test_generate_refuses_when_they_dont_match(self):
        with self.assertRaisesRegex(ValueError, "Parents.Gone has no note"):
            generate(SAMPLE, {**SAMPLE_NOTES, "Parents": note_for(["Id", "Name"])})


class ReplaceSection(unittest.TestCase):
    def test_only_touches_whats_between_the_markers(self):
        readme = f"before\n{START}\nold\n{END}\nafter\n"
        self.assertEqual(f"before\n{START}\nnew\n{END}\nafter\n", replace_section(readme, f"{START}\nnew\n{END}"))

    def test_refuses_without_markers(self):
        with self.assertRaises(ValueError):
            replace_section("no markers", "x")


# The real thing: a migration that changes the schema fails here until the
# notes and README catch up.
class TheRealReadme(unittest.TestCase):
    def setUp(self):
        self.snapshot = SNAPSHOT.read_text(encoding="utf-8-sig")
        self.notes = json.loads(NOTES.read_text(encoding="utf-8"))

    def test_every_table_and_column_has_a_note(self):
        tables, _ = parse_snapshot(self.snapshot)
        self.assertEqual([], problems(tables, self.notes))

    def test_finds_every_foreign_key_in_the_snapshot(self):
        _, relations = parse_snapshot(self.snapshot)
        self.assertEqual(self.snapshot.count("HasForeignKey("), len(relations))

    def test_the_readme_is_up_to_date(self):
        readme = README.read_text(encoding="utf-8").replace("\r\n", "\n")
        self.assertEqual(readme, replace_section(readme, generate(self.snapshot, self.notes)),
                         "annotation-store's README schema is out of date - run python scripts/db_docs.py")


if __name__ == "__main__":
    unittest.main()
