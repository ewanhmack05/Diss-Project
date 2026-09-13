using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class AddImageAdjustments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ImageAdjustments",
                columns: table => new
                {
                    ImageAdjustmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    SlideId = table.Column<string>(type: "text", nullable: false),
                    AdjustmentName = table.Column<string>(type: "text", nullable: false),
                    Adjustments = table.Column<string>(type: "text", nullable: false),
                    Created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImageAdjustments", x => x.ImageAdjustmentId);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ImageAdjustments_SlideId",
                table: "ImageAdjustments",
                column: "SlideId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ImageAdjustments");
        }
    }
}
