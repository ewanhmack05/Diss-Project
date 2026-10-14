using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class CollectionSharing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "Shared",
                table: "Collections",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Shared",
                table: "Collections");
        }
    }
}
