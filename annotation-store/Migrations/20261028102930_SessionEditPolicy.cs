using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class SessionEditPolicy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EditPolicy",
                table: "Collections",
                type: "text",
                nullable: false,
                // Collections already there keep how they've always behaved -
                // an empty string wouldn't read back as an EditPolicy at all.
                defaultValue: "LastWriteWins");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EditPolicy",
                table: "Collections");
        }
    }
}
