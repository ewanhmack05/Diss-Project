using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class CellCountDots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ColourBreakdown",
                table: "CellCounts");

            migrationBuilder.AddColumn<string>(
                name: "Dots",
                table: "CellCounts",
                type: "text",
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Dots",
                table: "CellCounts");

            migrationBuilder.AddColumn<string>(
                name: "ColourBreakdown",
                table: "CellCounts",
                type: "text",
                nullable: false,
                defaultValue: "[]");
        }
    }
}
