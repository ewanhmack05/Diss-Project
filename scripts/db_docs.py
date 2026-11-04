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

# Mermaid's attribute types can't have spaces.
SHORT_TYPES = {"timestamp with time zone": "timestamptz", "double precision": "double"}
DELETES = {"Cascade": "cascade", "SetNull": "set null", "Restrict": "restrict", "NoAction": "no action"}

ENTITY = re.compile(r'modelBuilder\.Entity\("([^"]+)", b =>\s*\{(.*?)\n\s*\}\);', re.DOTALL)
PROPERTY = re.compile(r'b\.Property<([^>]+)>\("([^"]+)"\)([^;]*);', re.DOTALL)


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
                    "on_delete": DELETES.get(behaviour.group(1), behaviour.group(1)) if behaviour else "no action",
                })
    # EF leaves IsRequired off a string key, since a key can't be null anyway.
    for table in tables.values():
        for column in table["columns"]:
            if column["name"] in table["key"]:
                column["nullable"] = False
    resolved = [{**r, "from": tables[r["from"]]["name"], "to": tables[r["to"]]["name"]} for r in relations]
    return {t["name"]: t for t in tables.values()}, resolved


def foreign_keys(table_name, relations):
    return {r["column"]: r for r in relations if r["to"] == table_name}


def key_text(column, table, fks):
    keys = []
    if column["name"] in table["key"]:
        keys.append("PK")
    if column["name"] in fks:
        keys.append("FK")
    return ",".join(keys)


def mermaid_type(column_type):
    return SHORT_TYPES.get(column_type, column_type).replace(" ", "_")


def diagram(tables, relations, order):
    lines = ["```mermaid", "erDiagram"]
    for name in order:
        table = tables[name]
        fks = foreign_keys(name, relations)
        lines.append(f'  "{name}" {{')
        for column in table["columns"]:
            keys = key_text(column, table, fks)
            nullable = ' "null"' if column["nullable"] else ""
            lines.append(f'    {mermaid_type(column["type"])} {column["name"]}{" " + keys if keys else ""}{nullable}')
        lines.append("  }")
    for relation in relations:
        parent = "||" if relation["required"] else "|o"
        child = "o|" if relation["one_to_one"] else "o{"
        lines.append(f'  "{relation["from"]}" {parent}--{child} "{relation["to"]}" : "{relation["column"]}, {relation["on_delete"]}"')
    lines.append("```")
    return "\n".join(lines)


def table_section(name, table, relations, note):
    fks = foreign_keys(name, relations)
    lines = [f"### {name}", "", note["summary"], "", f"**To make one:** {note['make']}", "",
             "| Column | Type | Key | Set by | Notes |", "|---|---|---|---|---|"]
    for column in table["columns"]:
        set_by, what = note["columns"][column["name"]]
        type_text = SHORT_TYPES.get(column["type"], column["type"]) + (", null" if column["nullable"] else "")
        lines.append(f"| `{column['name']}` | {type_text} | {key_text(column, table, fks)} | {set_by} | {what} |")
    extras = []
    for index in table["indexes"]:
        where = f" where `{index['filter']}`" if index["filter"] else ""
        extras.append(f"{'unique ' if index['unique'] else ''}index on `{', '.join(index['columns'])}`{where}")
    for relation in relations:
        if relation["to"] == name:
            extras.append(f"`{relation['column']}` points at `{relation['from']}`, {relation['on_delete']} when that's deleted")
    if extras:
        lines += ["", "Also: " + "; ".join(extras) + "."]
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


def generate(snapshot_text, notes):
    tables, relations = parse_snapshot(snapshot_text)
    missing = problems(tables, notes)
    if missing:
        raise ValueError("schema-notes.json doesn't match the schema:\n  " + "\n  ".join(missing))
    order = list(notes)
    parts = [START, "", diagram(tables, relations, order), ""]
    parts += [part for name in order for part in (table_section(name, tables[name], relations, notes[name]), "")]
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
