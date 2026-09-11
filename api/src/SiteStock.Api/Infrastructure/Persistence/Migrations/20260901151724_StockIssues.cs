using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SiteStock.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class StockIssues : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_returnable",
                table: "materials",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "stock_recipients",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    site_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    trade = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    contractor = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    phone_number = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_stock_recipients", x => x.id);
                    table.ForeignKey(
                        name: "fk_stock_recipients_sites_site_id",
                        column: x => x.site_id,
                        principalTable: "sites",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "stock_issues",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    site_id = table.Column<Guid>(type: "uuid", nullable: false),
                    recipient_id = table.Column<Guid>(type: "uuid", nullable: false),
                    issued_on = table.Column<DateOnly>(type: "date", nullable: false),
                    work_area = table.Column<string>(type: "character varying(140)", maxLength: 140, nullable: true),
                    notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    issued_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_stock_issues", x => x.id);
                    table.ForeignKey(
                        name: "fk_stock_issues_sites_site_id",
                        column: x => x.site_id,
                        principalTable: "sites",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_stock_issues_stock_recipients_recipient_id",
                        column: x => x.recipient_id,
                        principalTable: "stock_recipients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_stock_issues_users_issued_by_id",
                        column: x => x.issued_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "stock_issue_lines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    stock_issue_id = table.Column<Guid>(type: "uuid", nullable: false),
                    material_id = table.Column<Guid>(type: "uuid", nullable: false),
                    quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    is_returnable = table.Column<bool>(type: "boolean", nullable: false),
                    quantity_returned = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    notes = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_stock_issue_lines", x => x.id);
                    table.ForeignKey(
                        name: "fk_stock_issue_lines_materials_material_id",
                        column: x => x.material_id,
                        principalTable: "materials",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_stock_issue_lines_stock_issues_stock_issue_id",
                        column: x => x.stock_issue_id,
                        principalTable: "stock_issues",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_stock_issue_lines_is_returnable_quantity_returned",
                table: "stock_issue_lines",
                columns: new[] { "is_returnable", "quantity_returned" });

            migrationBuilder.CreateIndex(
                name: "ix_stock_issue_lines_material_id",
                table: "stock_issue_lines",
                column: "material_id");

            migrationBuilder.CreateIndex(
                name: "ix_stock_issue_lines_stock_issue_id",
                table: "stock_issue_lines",
                column: "stock_issue_id");

            migrationBuilder.CreateIndex(
                name: "ix_stock_issues_issued_by_id",
                table: "stock_issues",
                column: "issued_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_stock_issues_number",
                table: "stock_issues",
                column: "number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_stock_issues_recipient_id",
                table: "stock_issues",
                column: "recipient_id");

            migrationBuilder.CreateIndex(
                name: "ix_stock_issues_site_id_issued_on",
                table: "stock_issues",
                columns: new[] { "site_id", "issued_on" });

            migrationBuilder.CreateIndex(
                name: "ix_stock_recipients_site_id_name",
                table: "stock_recipients",
                columns: new[] { "site_id", "name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "stock_issue_lines");

            migrationBuilder.DropTable(
                name: "stock_issues");

            migrationBuilder.DropTable(
                name: "stock_recipients");

            migrationBuilder.DropColumn(
                name: "is_returnable",
                table: "materials");
        }
    }
}
