using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SiteStock.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RequisitionAmendments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "amended_after_pricing_at",
                table: "requisitions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "amended_at",
                table: "requisitions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "amended_at",
                table: "requisition_lines",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "quantity_before",
                table: "requisition_lines",
                type: "numeric",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "requisition_amendments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    requisition_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    material_name = table.Column<string>(type: "character varying(140)", maxLength: 140, nullable: true),
                    material_id = table.Column<Guid>(type: "uuid", nullable: true),
                    before = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    after = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    reason = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    after_pricing = table.Column<bool>(type: "boolean", nullable: false),
                    changed_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    changed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_requisition_amendments", x => x.id);
                    table.ForeignKey(
                        name: "fk_requisition_amendments_requisitions_requisition_id",
                        column: x => x.requisition_id,
                        principalTable: "requisitions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_requisition_amendments_users_changed_by_id",
                        column: x => x.changed_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_requisition_amendments_changed_by_id",
                table: "requisition_amendments",
                column: "changed_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_requisition_amendments_requisition_id_changed_at",
                table: "requisition_amendments",
                columns: new[] { "requisition_id", "changed_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "requisition_amendments");

            migrationBuilder.DropColumn(
                name: "amended_after_pricing_at",
                table: "requisitions");

            migrationBuilder.DropColumn(
                name: "amended_at",
                table: "requisitions");

            migrationBuilder.DropColumn(
                name: "amended_at",
                table: "requisition_lines");

            migrationBuilder.DropColumn(
                name: "quantity_before",
                table: "requisition_lines");
        }
    }
}
