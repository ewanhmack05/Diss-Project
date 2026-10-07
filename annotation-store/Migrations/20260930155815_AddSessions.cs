using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class AddSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Collections_SlideId_UserId",
                table: "Collections");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "Ended",
                table: "Collections",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "Collections",
                type: "text",
                nullable: false,
                // Everything from before sessions is a personal collection.
                defaultValue: "Personal");

            migrationBuilder.CreateTable(
                name: "CollectionInvites",
                columns: table => new
                {
                    Code = table.Column<string>(type: "text", nullable: false),
                    CollectionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Role = table.Column<string>(type: "text", nullable: false),
                    CreatedById = table.Column<string>(type: "text", nullable: false),
                    Created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Expires = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Stopped = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollectionInvites", x => x.Code);
                    table.ForeignKey(
                        name: "FK_CollectionInvites_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalTable: "Collections",
                        principalColumn: "CollectionId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Collections_SlideId_UserId",
                table: "Collections",
                columns: new[] { "SlideId", "UserId" },
                unique: true,
                filter: "\"Kind\" = 'Personal'");

            migrationBuilder.CreateIndex(
                name: "IX_CollectionInvites_CollectionId",
                table: "CollectionInvites",
                column: "CollectionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CollectionInvites");

            migrationBuilder.DropIndex(
                name: "IX_Collections_SlideId_UserId",
                table: "Collections");

            migrationBuilder.DropColumn(
                name: "Ended",
                table: "Collections");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "Collections");

            migrationBuilder.CreateIndex(
                name: "IX_Collections_SlideId_UserId",
                table: "Collections",
                columns: new[] { "SlideId", "UserId" },
                unique: true);
        }
    }
}
