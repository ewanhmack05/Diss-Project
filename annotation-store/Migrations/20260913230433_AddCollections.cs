using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class AddCollections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Collections",
                columns: table => new
                {
                    CollectionId = table.Column<Guid>(type: "uuid", nullable: false),
                    SlideId = table.Column<string>(type: "text", nullable: false),
                    CollectionName = table.Column<string>(type: "text", nullable: false),
                    Created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Collections", x => x.CollectionId);
                });

            // Nullable to start, not the scaffolded "nullable: false, default
            // Guid.Empty" - existing rows (this table may already hold real
            // data, e.g. seed-test-data.sql) need a real Collections row to
            // point at before the column can be made required, and Guid.Empty
            // would never satisfy the foreign key added further down.
            migrationBuilder.AddColumn<Guid>(
                name: "CollectionId",
                table: "ImageAdjustments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CollectionId",
                table: "CellCounts",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CollectionId",
                table: "Annotations",
                type: "uuid",
                nullable: true);

            // One legacy collection per distinct SlideId already present
            // across the three tables, owned by the placeholder user (real
            // auth doesn't exist yet - see AnnotationStore.ImageAdjustments'
            // own UserId field for the same placeholder convention) so
            // existing rows have somewhere real to belong before CollectionId
            // becomes required below.
            migrationBuilder.Sql(
                """
                INSERT INTO "Collections" ("CollectionId", "SlideId", "CollectionName", "Created", "UserId")
                SELECT gen_random_uuid(), existing_slides.slide_id, 'Legacy collection', now(), '001'
                FROM (
                    SELECT DISTINCT "SlideId" AS slide_id FROM "Annotations"
                    UNION
                    SELECT DISTINCT "SlideId" FROM "CellCounts"
                    UNION
                    SELECT DISTINCT "SlideId" FROM "ImageAdjustments"
                ) existing_slides
                WHERE NOT EXISTS (
                    SELECT 1 FROM "Collections" c
                    WHERE c."SlideId" = existing_slides.slide_id AND c."UserId" = '001'
                );

                UPDATE "Annotations" a
                SET "CollectionId" = c."CollectionId"
                FROM "Collections" c
                WHERE c."SlideId" = a."SlideId" AND c."UserId" = '001';

                UPDATE "CellCounts" cc
                SET "CollectionId" = c."CollectionId"
                FROM "Collections" c
                WHERE c."SlideId" = cc."SlideId" AND c."UserId" = '001';

                UPDATE "ImageAdjustments" ia
                SET "CollectionId" = c."CollectionId"
                FROM "Collections" c
                WHERE c."SlideId" = ia."SlideId" AND c."UserId" = '001';
                """);

            migrationBuilder.AlterColumn<Guid>(
                name: "CollectionId",
                table: "ImageAdjustments",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "CollectionId",
                table: "CellCounts",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "CollectionId",
                table: "Annotations",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ImageAdjustments_CollectionId",
                table: "ImageAdjustments",
                column: "CollectionId");

            migrationBuilder.CreateIndex(
                name: "IX_CellCounts_CollectionId",
                table: "CellCounts",
                column: "CollectionId");

            migrationBuilder.CreateIndex(
                name: "IX_Annotations_CollectionId",
                table: "Annotations",
                column: "CollectionId");

            migrationBuilder.CreateIndex(
                name: "IX_Collections_SlideId_UserId",
                table: "Collections",
                columns: new[] { "SlideId", "UserId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Annotations_Collections_CollectionId",
                table: "Annotations",
                column: "CollectionId",
                principalTable: "Collections",
                principalColumn: "CollectionId",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_CellCounts_Collections_CollectionId",
                table: "CellCounts",
                column: "CollectionId",
                principalTable: "Collections",
                principalColumn: "CollectionId",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_ImageAdjustments_Collections_CollectionId",
                table: "ImageAdjustments",
                column: "CollectionId",
                principalTable: "Collections",
                principalColumn: "CollectionId",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Annotations_Collections_CollectionId",
                table: "Annotations");

            migrationBuilder.DropForeignKey(
                name: "FK_CellCounts_Collections_CollectionId",
                table: "CellCounts");

            migrationBuilder.DropForeignKey(
                name: "FK_ImageAdjustments_Collections_CollectionId",
                table: "ImageAdjustments");

            migrationBuilder.DropTable(
                name: "Collections");

            migrationBuilder.DropIndex(
                name: "IX_ImageAdjustments_CollectionId",
                table: "ImageAdjustments");

            migrationBuilder.DropIndex(
                name: "IX_CellCounts_CollectionId",
                table: "CellCounts");

            migrationBuilder.DropIndex(
                name: "IX_Annotations_CollectionId",
                table: "Annotations");

            migrationBuilder.DropColumn(
                name: "CollectionId",
                table: "ImageAdjustments");

            migrationBuilder.DropColumn(
                name: "CollectionId",
                table: "CellCounts");

            migrationBuilder.DropColumn(
                name: "CollectionId",
                table: "Annotations");
        }
    }
}
