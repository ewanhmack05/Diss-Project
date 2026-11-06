using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class CellCountGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "GroupId",
                table: "CellCounts",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CellCountGroups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CollectionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: false),
                    Created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CellCountGroups", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CellCountGroups_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalTable: "Collections",
                        principalColumn: "CollectionId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CellCounts_GroupId",
                table: "CellCounts",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_CellCountGroups_CollectionId",
                table: "CellCountGroups",
                column: "CollectionId");

            migrationBuilder.AddForeignKey(
                name: "FK_CellCounts_CellCountGroups_GroupId",
                table: "CellCounts",
                column: "GroupId",
                principalTable: "CellCountGroups",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CellCounts_CellCountGroups_GroupId",
                table: "CellCounts");

            migrationBuilder.DropTable(
                name: "CellCountGroups");

            migrationBuilder.DropIndex(
                name: "IX_CellCounts_GroupId",
                table: "CellCounts");

            migrationBuilder.DropColumn(
                name: "GroupId",
                table: "CellCounts");
        }
    }
}
