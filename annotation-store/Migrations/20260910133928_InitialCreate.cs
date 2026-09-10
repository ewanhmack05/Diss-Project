using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Annotations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SlideId = table.Column<string>(type: "text", nullable: false),
                    Label = table.Column<string>(type: "text", nullable: false),
                    Colour = table.Column<string>(type: "text", nullable: false),
                    Shape = table.Column<string>(type: "text", nullable: false),
                    LineStyle = table.Column<string>(type: "text", nullable: false),
                    LineThickness = table.Column<int>(type: "integer", nullable: false),
                    GeoJson = table.Column<string>(type: "text", nullable: false),
                    Created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Annotations", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Annotations_SlideId",
                table: "Annotations",
                column: "SlideId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Annotations");
        }
    }
}
