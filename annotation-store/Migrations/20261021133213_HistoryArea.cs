using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace AnnotationStore.Migrations
{
    // History gets a schema of its own, and the live tables stop keeping
    // deleted rows. Every row soft deleted so far becomes a delete entry -
    // the whole row as it was, under the change set that deleted it - and
    // is then removed, so restoring it still works. Collections keep Deleted
    // (they hold everything in them, so they're hidden rather than removed)
    // but lose DeletedIn, since the entry says which change did it.
    public partial class HistoryArea : Migration
    {
        // Postgres' own row-to-JSON, which uses the column names - the same
        // shape HistoryLog writes, so either can be put back.
        private static readonly string[] Moves =
        [
            Move("Annotations", "annotation", "Id"),
            Move("AnnotationGroups", "group", "Id"),
            Move("CellCounts", "cellCount", "Id"),
            Move("ImageAdjustments", "imageAdjustment", "ImageAdjustmentId"),
            """
            INSERT INTO history."Entries" ("ChangeSetId", "CollectionId", "Entity", "EntityId", "Op", "Before")
            SELECT c."DeletedIn", c."CollectionId", 'regionOfInterest', r."Id", 'Delete', to_jsonb(r)
            FROM "RegionsOfInterest" r JOIN "CellCounts" c ON c."Id" = r."CellCountId"
            WHERE c."Deleted" IS NOT NULL AND c."DeletedIn" IS NOT NULL;
            """,
            """
            INSERT INTO history."Entries" ("ChangeSetId", "CollectionId", "Entity", "EntityId", "Op")
            SELECT c."DeletedIn", c."CollectionId", 'collection', c."CollectionId", 'Delete'
            FROM "Collections" c
            WHERE c."Deleted" IS NOT NULL AND c."DeletedIn" IS NOT NULL;
            """,
        ];

        private static string Move(string table, string entity, string key) => $"""
            INSERT INTO history."Entries" ("ChangeSetId", "CollectionId", "Entity", "EntityId", "Op", "Before")
            SELECT t."DeletedIn", t."CollectionId", '{entity}', t."{key}", 'Delete', to_jsonb(t) - 'Deleted' - 'DeletedIn'
            FROM "{table}" t
            WHERE t."Deleted" IS NOT NULL AND t."DeletedIn" IS NOT NULL;
            """;

        // Annotations before their groups; a count's region of interest goes
        // with it (cascade).
        private static readonly string[] Removes =
            ["Annotations", "AnnotationGroups", "CellCounts", "ImageAdjustments"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(name: "history");

            migrationBuilder.RenameTable(
                name: "ChangeSets",
                newName: "ChangeSets",
                newSchema: "history");

            migrationBuilder.CreateTable(
                name: "Entries",
                schema: "history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ChangeSetId = table.Column<Guid>(type: "uuid", nullable: false),
                    CollectionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Entity = table.Column<string>(type: "text", nullable: false),
                    EntityId = table.Column<Guid>(type: "uuid", nullable: false),
                    Op = table.Column<string>(type: "text", nullable: false),
                    Before = table.Column<string>(type: "jsonb", nullable: true),
                    After = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Entries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Entries_ChangeSets_ChangeSetId",
                        column: x => x.ChangeSetId,
                        principalSchema: "history",
                        principalTable: "ChangeSets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Entries_ChangeSetId",
                schema: "history",
                table: "Entries",
                column: "ChangeSetId");

            migrationBuilder.CreateIndex(
                name: "IX_Entries_CollectionId_Entity_EntityId",
                schema: "history",
                table: "Entries",
                columns: new[] { "CollectionId", "Entity", "EntityId" });

            foreach (var move in Moves) migrationBuilder.Sql(move);
            foreach (var table in Removes)
                migrationBuilder.Sql($"""DELETE FROM "{table}" WHERE "Deleted" IS NOT NULL AND "DeletedIn" IS NOT NULL;""");

            foreach (var table in new[] { "ImageAdjustments", "Collections", "CellCounts", "Annotations", "AnnotationGroups" })
                migrationBuilder.DropIndex(name: $"IX_{table}_DeletedIn", table: table);
            foreach (var table in new[] { "ImageAdjustments", "CellCounts", "Annotations", "AnnotationGroups" })
                migrationBuilder.DropColumn(name: "Deleted", table: table);
            foreach (var table in new[] { "ImageAdjustments", "Collections", "CellCounts", "Annotations", "AnnotationGroups" })
                migrationBuilder.DropColumn(name: "DeletedIn", table: table);
        }

        // Back to soft delete: every row a delete entry holds that isn't live
        // goes back in its table, hidden, from its latest delete. The history
        // of edits is lost - soft delete had nowhere to keep it.
        private static string Unmove(string table, string entity, string key) => $"""
            INSERT INTO "{table}"
            SELECT (jsonb_populate_record(NULL::"{table}",
                e."Before" || jsonb_build_object('Deleted', cs."Created", 'DeletedIn', e."ChangeSetId"))).*
            FROM (
                SELECT DISTINCT ON ("EntityId") * FROM history."Entries"
                WHERE "Entity" = '{entity}' AND "Op" = 'Delete' AND "Before" IS NOT NULL
                ORDER BY "EntityId", "Id" DESC
            ) e
            JOIN history."ChangeSets" cs ON cs."Id" = e."ChangeSetId"
            WHERE NOT EXISTS (SELECT 1 FROM "{table}" t WHERE t."{key}" = e."EntityId");
            """;

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var table in new[] { "ImageAdjustments", "CellCounts", "Annotations", "AnnotationGroups" })
                migrationBuilder.AddColumn<DateTimeOffset>(name: "Deleted", table: table, type: "timestamp with time zone", nullable: true);
            foreach (var table in new[] { "ImageAdjustments", "Collections", "CellCounts", "Annotations", "AnnotationGroups" })
                migrationBuilder.AddColumn<Guid>(name: "DeletedIn", table: table, type: "uuid", nullable: true);

            migrationBuilder.Sql(Unmove("AnnotationGroups", "group", "Id"));
            migrationBuilder.Sql(Unmove("Annotations", "annotation", "Id"));
            migrationBuilder.Sql(Unmove("CellCounts", "cellCount", "Id"));
            migrationBuilder.Sql(Unmove("ImageAdjustments", "imageAdjustment", "ImageAdjustmentId"));
            migrationBuilder.Sql("""
                INSERT INTO "RegionsOfInterest"
                SELECT (jsonb_populate_record(NULL::"RegionsOfInterest", e."Before")).*
                FROM (
                    SELECT DISTINCT ON ("EntityId") * FROM history."Entries"
                    WHERE "Entity" = 'regionOfInterest' AND "Op" = 'Delete' AND "Before" IS NOT NULL
                    ORDER BY "EntityId", "Id" DESC
                ) e
                WHERE NOT EXISTS (SELECT 1 FROM "RegionsOfInterest" r WHERE r."Id" = e."EntityId")
                  AND EXISTS (SELECT 1 FROM "CellCounts" c WHERE c."Id" = (e."Before" ->> 'CellCountId')::uuid);
                """);
            migrationBuilder.Sql("""
                UPDATE "Collections" c SET "DeletedIn" = (
                    SELECT e."ChangeSetId" FROM history."Entries" e
                    WHERE e."Entity" = 'collection' AND e."Op" = 'Delete' AND e."EntityId" = c."CollectionId"
                    ORDER BY e."Id" DESC LIMIT 1)
                WHERE c."Deleted" IS NOT NULL;
                """);

            migrationBuilder.DropTable(name: "Entries", schema: "history");
            migrationBuilder.RenameTable(name: "ChangeSets", schema: "history", newName: "ChangeSets", newSchema: "public");

            foreach (var table in new[] { "ImageAdjustments", "Collections", "CellCounts", "Annotations", "AnnotationGroups" })
                migrationBuilder.CreateIndex(name: $"IX_{table}_DeletedIn", table: table, column: "DeletedIn");
        }
    }
}
