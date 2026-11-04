"""Writes annotation-store's database layout into its README: a diagram and a
table of columns for each model. The tables, columns, keys and relationships
come from EF's model snapshot, so they're what the migrations actually made.
What each one is for comes from annotation-store/schema-notes.json, by hand.

test_db_docs.py fails if the README's out of date, or if a column has no note,
so a migration can't quietly leave these wrong. After changing the schema:

    python scripts/db_docs.py          # rewrites the README's schema section
    python scripts/db_docs.py --check  # says whether it needs to
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "annotation-store" / "Migrations" / "AnnotationDbContextModelSnapshot.cs"
NOTES = ROOT / "annotation-store" / "schema-notes.json"
README = ROOT / "annotation-store" / "README.md"
START = "<!-- schema:start - written by scripts/db_docs.py, don't edit by hand -->"
END = "<!-- schema:end -->"

# What each column type means, in the order they're listed. A test fails if the
# schema uses one that isn't here.
TYPE_MEANINGS = {
    "uuid": "A 128-bit random id, like `33afa424-ed8b-4489-ab20-ee917f31880c`. Used for most ids, since the viewer can make one itself before saving",
    "bigint": "A 64-bit whole number. Used where ids count up, so their order means something",
    "integer": "A 32-bit whole number",
    "double precision": "A 64-bit decimal number",
    "boolean": "True or false",
    "text": "A string of any length. Also holds some JSON that's only stored and handed back, like `GeoJson` and `Dots`",
    "jsonb": "JSON that Postgres has parsed, so the database can read inside it. Used by the history, which pulls fields out of it in SQL",
    "timestamp with time zone": "A moment in time, kept in UTC. Postgres also calls it `timestamptz`",
}

# What the rest of the diagram and tables are saying.
TERMS = [
    ("PK", "Primary key - what identifies a row. Two together, as on `CollectionMembers`, means the pair is what's unique"),
    ("FK", "Foreign key - a column pointing at another table's row. The database won't let it point at one that isn't there"),
    ("PK, FK", "Both - part of what identifies the row, and pointing at another table"),
    ("not null / null", "Whether a column has to have a value, or can be empty"),
    ("Index", "A lookup kept by the database, so finding rows by that column doesn't read the whole table"),
    ("Unique index", "An index that also refuses two rows with the same value"),
    ("Set by", "Where a value comes from: `client` is in the request, `server` is the store, `host` or `owner` is that person choosing it through the API"),
]

# What the ends of a line on the diagram mean. In words, since these are what's
# drawn, and the pipes in Mermaid's own spelling would split a Markdown table.
LINE_ENDS = [
    ("Two bars", "Exactly one"),
    ("A bar and a circle", "Zero or one"),
    ("A circle and three prongs", "Zero or more"),
]

# What a foreign key does when the row it points at is deleted, in words.
DELETES = {
    "Cascade": "Deleted with it",
    "SetNull": "Goes to null if that's deleted",
    "Restrict": "Stops that being deleted",
    "NoAction": "Stops that being deleted",
}

ENTITY = re.compile(r'modelBuilder\.Entity\("([^"]+)", b =>\s*\{(.*?)\n\s*\}\);', re.DOTALL)
# Only at the start of a line - b.Property also turns up inside other statements,
# like UseIdentityByDefaultColumn(b.Property<long>("Id")).
PROPERTY = re.compile(r'^\s*b\.Property<([^>]+)>\("([^"]+)"\)([^;]*);', re.DOTALL | re.MULTILINE)


def quoted(text):
    return re.findall(r'"([^"]+)"', text)


def statements(body):
    """The body's statements, starting at each `b.`."""
    return [part for part in re.split(r"(?=^\s*b\.)", body, flags=re.MULTILINE) if part.strip().startswith("b.")]


def parse_snapshot(text):
    """Every table: its columns, key, indexes and foreign keys."""
    tables = {}
    relations = []
    for full_name, body in ENTITY.findall(text):
        table = tables.setdefault(full_name, {"name": None, "columns": [], "key": [], "indexes": []})
        for clr, name, chain in PROPERTY.findall(body):
            column_type = re.search(r'HasColumnType\("([^"]+)"\)', chain)
            nullable = clr.endswith("?") or (clr == "string" and "IsRequired" not in chain)
            table["columns"].append({"name": name, "type": column_type.group(1) if column_type else clr, "nullable": nullable})
        for statement in statements(body):
            if statement.strip().startswith("b.HasKey"):
                table["key"] = quoted(statement)
            elif statement.strip().startswith("b.HasIndex"):
                columns = quoted(statement.split(")")[0])
                filtered = re.search(r'HasFilter\("(.*)"\)', statement)
                table["indexes"].append({"columns": columns, "unique": "IsUnique" in statement, "filter": filtered.group(1).replace('\\"', '"') if filtered else None})
            elif statement.strip().startswith("b.ToTable"):
                names = quoted(statement)
                table["name"] = f"{names[1]}.{names[0]}" if len(names) > 1 else names[0]
            elif statement.strip().startswith("b.HasOne"):
                behaviour = re.search(r"DeleteBehavior\.(\w+)", statement)
                relations.append({
                    "from": quoted(statement.split(",")[0])[0],
                    "to": full_name,
                    "column": quoted(statement[statement.index("HasForeignKey"):].split(")")[0])[-1],
                    "one_to_one": "WithOne" in statement,
                    "required": "IsRequired" in statement,
                    "on_delete": DELETES.get(behaviour.group(1), behaviour.group(1)) if behaviour else DELETES["NoAction"],
                })
    # EF leaves IsRequired off a string key, since a key can't be null anyway.
    for table in tables.values():
        for column in table["columns"]:
            if column["name"] in table["key"]:
                column["nullable"] = False
    resolved = [{**r, "from": tables[r["from"]]["name"], "to": tables[r["to"]]["name"], "from_key": tables[r["from"]]["key"][0]} for r in relations]
    return {t["name"]: t for t in tables.values()}, resolved


def foreign_keys(table_name, relations):
    return {r["column"]: r for r in relations if r["to"] == table_name}


def key_text(column, table, fks):
    keys = []
    if column["name"] in table["key"]:
        keys.append("PK")
    if column["name"] in fks:
        keys.append("FK")
    return ", ".join(keys)


def ordered_columns(table, fks):
    """Primary key, then foreign keys, then everything that has to have a value,
    then what can be null - by type, then name, within each."""
    def rank(column):
        if column["name"] in table["key"]:
            return (0, table["key"].index(column["name"]))
        if column["name"] in fks:
            return (1, 0)
        return (3 if column["nullable"] else 2, 0)

    return sorted(table["columns"], key=lambda c: (rank(c), c["nullable"], c["type"], c["name"].lower()))


def mermaid_type(column_type):
    return column_type.replace(" ", "_")


def mermaid_name(name):
    """Mermaid only takes a name with a dot in it, like history.Entries, in quotes."""
    return f'"{name}"' if "." in name else name


def relation_label(relation):
    """Which column points at which, like Annotations(GroupId) -> AnnotationGroups(Id)."""
    return f'{relation["to"]}({relation["column"]}) -> {relation["from"]}({relation["from_key"]})'


def diagram(tables, relations):
    lines = ["```mermaid", "erDiagram", ""]
    for name in sorted(tables, key=str.lower):
        table = tables[name]
        fks = foreign_keys(name, relations)
        lines.append(f"    {mermaid_name(name)} {{")
        for column in ordered_columns(table, fks):
            keys = key_text(column, table, fks)
            nullable = "null" if column["nullable"] else "not null"
            # Name first, then type. Mermaid calls those type and name, but only
            # draws them in that order - it doesn't read them.
            lines.append(f'        {column["name"]} {mermaid_type(column["type"])}{" " + keys if keys else ""} "{nullable}"')
        lines += ["    }", ""]
    for relation in sorted(relations, key=lambda r: (r["from"].lower(), r["to"].lower(), r["column"].lower())):
        parent = "||" if relation["required"] else "|o"
        child = "o|" if relation["one_to_one"] else "o{"
        lines.append(f'    {mermaid_name(relation["from"])} {parent}--{child} {mermaid_name(relation["to"])} : "{relation_label(relation)}"')
    lines.append("```")
    return "\n".join(lines)


def table_section(name, table, relations, note):
    fks = foreign_keys(name, relations)
    lines = [f"### {name}", "", note["summary"], "", f"**To make one:** {note['make']}", "",
             "| Column | Type | Key | Set by | Notes |", "|---|---|---|---|---|"]
    for column in ordered_columns(table, fks):
        set_by, what = note["columns"][column["name"]]
        type_text = column["type"] + (", null" if column["nullable"] else "")
        lines.append(f"| `{column['name']}` | {type_text} | {key_text(column, table, fks)} | {set_by} | {what} |")
    extras = []
    for index in table["indexes"]:
        where = f" where `{index['filter']}`" if index["filter"] else ""
        extras.append(f"{'Unique index' if index['unique'] else 'Index'} on `{', '.join(index['columns'])}`{where}")
    for relation in relations:
        if relation["to"] == name:
            extras.append(f"`{relation['column']}` points at `{relation['from']}.{relation['from_key']}`. {relation['on_delete']}")
    if extras:
        lines += ["", *[f"- {extra}" for extra in extras]]
    return "\n".join(lines)


def problems(tables, notes):
    """Anything in the schema with no note, or a note for what's not there."""
    found = []
    for name in tables.keys() - notes.keys():
        found.append(f"{name} is in the schema but has no note")
    for name in notes.keys() - tables.keys():
        found.append(f"{name} has a note but isn't in the schema")
    for name in tables.keys() & notes.keys():
        columns = {c["name"] for c in tables[name]["columns"]}
        noted = notes[name]["columns"].keys()
        found += [f"{name}.{c} has no note" for c in sorted(columns - noted)]
        found += [f"{name}.{c} has a note but isn't a column" for c in sorted(noted - columns)]
    return sorted(found)


def types_without_meaning(tables):
    used = {column["type"] for table in tables.values() for column in table["columns"]}
    return sorted(used - TYPE_MEANINGS.keys())


def glossary():
    lines = ["### Reading the diagram and tables", "", "The diagram puts underscores in a type with spaces, since it can't draw them otherwise.", "",
             "| Type | What it is |", "|---|---|"]
    lines += [f"| `{name}` | {meaning} |" for name, meaning in TYPE_MEANINGS.items()]
    lines += ["", "| Term | What it means |", "|---|---|"]
    lines += [f"| {term} | {meaning} |" for term, meaning in TERMS]
    lines += ["", "| Line end | How many rows of the table it's next to |", "|---|---|"]
    lines += [f"| {end} | {meaning} |" for end, meaning in LINE_ENDS]
    return "\n".join(lines)


def generate(snapshot_text, notes):
    tables, relations = parse_snapshot(snapshot_text)
    missing = problems(tables, notes)
    if missing:
        raise ValueError("schema-notes.json doesn't match the schema:\n  " + "\n  ".join(missing))
    unexplained = types_without_meaning(tables)
    if unexplained:
        raise ValueError("TYPE_MEANINGS in db_docs.py has nothing for: " + ", ".join(unexplained))
    parts = [START, "", diagram(tables, relations), "", glossary(), ""]
    parts += [part for name in notes for part in (table_section(name, tables[name], relations, notes[name]), "")]
    return "\n".join(parts + [END])


def replace_section(readme, section):
    if START not in readme or END not in readme:
        raise ValueError("The README has no schema markers to write between")
    before = readme[:readme.index(START)]
    after = readme[readme.index(END) + len(END):]
    return before + section + after


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="only say whether the README's up to date")
    args = parser.parse_args(argv)
    notes = json.loads(NOTES.read_text(encoding="utf-8"))
    # Git checks files out with CRLF on Windows, which isn't a change.
    readme = README.read_text(encoding="utf-8").replace("\r\n", "\n")
    updated = replace_section(readme, generate(SNAPSHOT.read_text(encoding="utf-8-sig"), notes))
    if args.check:
        if updated != readme:
            sys.exit("annotation-store's README schema is out of date - run python scripts/db_docs.py")
        print("Up to date")
        return
    README.write_text(updated, encoding="utf-8", newline="\n")
    print("Written")


if __name__ == "__main__":
    main()
