using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class AnnotationSliceRange : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SliceFrom",
                table: "Annotations",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SliceTo",
                table: "Annotations",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SliceFrom",
                table: "Annotations");

            migrationBuilder.DropColumn(
                name: "SliceTo",
                table: "Annotations");
        }
    }
}
