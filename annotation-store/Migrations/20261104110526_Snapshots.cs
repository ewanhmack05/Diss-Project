using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace AnnotationStore.Migrations
{
    /// <inheritdoc />
    public partial class Snapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Snapshots",
                schema: "history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CollectionId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpToEntry = table.Column<long>(type: "bigint", nullable: false),
                    Created = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Rows = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Snapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Snapshots_Collections_CollectionId",
                        column: x => x.CollectionId,
                        principalTable: "Collections",
                        principalColumn: "CollectionId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Snapshots_CollectionId_UpToEntry",
                schema: "history",
                table: "Snapshots",
                columns: new[] { "CollectionId", "UpToEntry" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Snapshots",
                schema: "history");
        }
    }
}
