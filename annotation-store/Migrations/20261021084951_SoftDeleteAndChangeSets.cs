using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class SoftDeleteAndChangeSets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Collections_SlideId_UserId",
                table: "Collections");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "Deleted",
                table: "ImageAdjustments",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeletedIn",
                table: "ImageAdjustments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "Deleted",
                table: "Collections",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeletedIn",
                table: "Collections",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "Deleted",
                table: "CellCounts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeletedIn",
                table: "CellCounts",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "Deleted",
                table: "Annotations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeletedIn",
                table: "Annotations",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "Deleted",
                table: "AnnotationGroups",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeletedIn",
                table: "AnnotationGroups",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ChangeSets",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CollectionId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    UserName = table.Column<string>(type: "text", nullable: false),
                    What = table.Column<string>(type: "text", nullable: false),
                    Created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChangeSets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChangeSets_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalTable: "Collections",
                        principalColumn: "CollectionId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ImageAdjustments_DeletedIn",
                table: "ImageAdjustments",
                column: "DeletedIn");

            migrationBuilder.CreateIndex(
                name: "IX_Collections_DeletedIn",
                table: "Collections",
                column: "DeletedIn");

            migrationBuilder.CreateIndex(
                name: "IX_Collections_SlideId_UserId",
                table: "Collections",
                columns: new[] { "SlideId", "UserId" },
                unique: true,
                filter: "\"Kind\" = 'Personal' AND \"Deleted\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CellCounts_DeletedIn",
                table: "CellCounts",
                column: "DeletedIn");

            migrationBuilder.CreateIndex(
                name: "IX_Annotations_DeletedIn",
                table: "Annotations",
                column: "DeletedIn");

            migrationBuilder.CreateIndex(
                name: "IX_AnnotationGroups_DeletedIn",
                table: "AnnotationGroups",
                column: "DeletedIn");

            migrationBuilder.CreateIndex(
                name: "IX_ChangeSets_CollectionId_Created",
                table: "ChangeSets",
                columns: new[] { "CollectionId", "Created" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChangeSets");

            migrationBuilder.DropIndex(
                name: "IX_ImageAdjustments_DeletedIn",
                table: "ImageAdjustments");

            migrationBuilder.DropIndex(
                name: "IX_Collections_DeletedIn",
                table: "Collections");

            migrationBuilder.DropIndex(
                name: "IX_Collections_SlideId_UserId",
                table: "Collections");

            migrationBuilder.DropIndex(
                name: "IX_CellCounts_DeletedIn",
                table: "CellCounts");

            migrationBuilder.DropIndex(
                name: "IX_Annotations_DeletedIn",
                table: "Annotations");

            migrationBuilder.DropIndex(
                name: "IX_AnnotationGroups_DeletedIn",
                table: "AnnotationGroups");

            migrationBuilder.DropColumn(
                name: "Deleted",
                table: "ImageAdjustments");

            migrationBuilder.DropColumn(
                name: "DeletedIn",
                table: "ImageAdjustments");

            migrationBuilder.DropColumn(
                name: "Deleted",
                table: "Collections");

            migrationBuilder.DropColumn(
                name: "DeletedIn",
                table: "Collections");

            migrationBuilder.DropColumn(
                name: "Deleted",
                table: "CellCounts");

            migrationBuilder.DropColumn(
                name: "DeletedIn",
                table: "CellCounts");

            migrationBuilder.DropColumn(
                name: "Deleted",
                table: "Annotations");

            migrationBuilder.DropColumn(
                name: "DeletedIn",
                table: "Annotations");

            migrationBuilder.DropColumn(
                name: "Deleted",
                table: "AnnotationGroups");

            migrationBuilder.DropColumn(
                name: "DeletedIn",
                table: "AnnotationGroups");

            migrationBuilder.CreateIndex(
                name: "IX_Collections_SlideId_UserId",
                table: "Collections",
                columns: new[] { "SlideId", "UserId" },
                unique: true,
                filter: "\"Kind\" = 'Personal'");
        }
    }
}
