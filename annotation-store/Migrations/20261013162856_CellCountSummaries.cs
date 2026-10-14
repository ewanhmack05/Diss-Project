using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class CellCountSummaries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ColourCountsJson",
                table: "CellCounts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PlacedByCountsJson",
                table: "CellCounts",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ColourCountsJson",
                table: "CellCounts");

            migrationBuilder.DropColumn(
                name: "PlacedByCountsJson",
                table: "CellCounts");
        }
    }
}
