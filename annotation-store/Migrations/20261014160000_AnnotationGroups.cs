using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class AnnotationGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "GroupId",
                table: "Annotations",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AnnotationGroups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CollectionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AnnotationGroups", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AnnotationGroups_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalTable: "Collections",
                        principalColumn: "CollectionId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Annotations_GroupId",
                table: "Annotations",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_AnnotationGroups_CollectionId",
                table: "AnnotationGroups",
                column: "CollectionId");

            migrationBuilder.AddForeignKey(
                name: "FK_Annotations_AnnotationGroups_GroupId",
                table: "Annotations",
                column: "GroupId",
                principalTable: "AnnotationGroups",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Annotations_AnnotationGroups_GroupId",
                table: "Annotations");

            migrationBuilder.DropTable(
                name: "AnnotationGroups");

            migrationBuilder.DropIndex(
                name: "IX_Annotations_GroupId",
                table: "Annotations");

            migrationBuilder.DropColumn(
                name: "GroupId",
                table: "Annotations");
        }
    }
}
