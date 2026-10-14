using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class DefaultColourOnPalette : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The viewer's old default, #fff614, was next to the palette's
            // yellow but not on it, so annotations drawn without picking a
            // colour showed as Custom and didn't filter as yellow. The
            // default is the palette's yellow now; this moves the old ones
            // over too. Cell count dots are left as they are.
            migrationBuilder.Sql("""
                UPDATE "Annotations" SET "Colour" = '#F9E006' WHERE lower("Colour") = '#fff614';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Nothing to undo - which rows were #fff614 isn't kept.
        }
    }
}
