using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SiteStock.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class WorkOrders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "work_order_id",
                table: "requisitions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "work_order_id",
                table: "purchase_orders",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "work_orders",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    client_name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    client_reference = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    site_id = table.Column<Guid>(type: "uuid", nullable: false),
                    contract_value = table.Column<decimal>(type: "numeric(16,2)", precision: 16, scale: 2, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    start_date = table.Column<DateOnly>(type: "date", nullable: true),
                    end_date = table.Column<DateOnly>(type: "date", nullable: true),
                    scope_summary = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_work_orders", x => x.id);
                    table.ForeignKey(
                        name: "fk_work_orders_sites_site_id",
                        column: x => x.site_id,
                        principalTable: "sites",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_requisitions_work_order_id",
                table: "requisitions",
                column: "work_order_id");

            migrationBuilder.CreateIndex(
                name: "ix_purchase_orders_work_order_id",
                table: "purchase_orders",
                column: "work_order_id");

            migrationBuilder.CreateIndex(
                name: "ix_work_orders_number",
                table: "work_orders",
                column: "number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_work_orders_site_id_status",
                table: "work_orders",
                columns: new[] { "site_id", "status" });

            migrationBuilder.AddForeignKey(
                name: "fk_purchase_orders_work_orders_work_order_id",
                table: "purchase_orders",
                column: "work_order_id",
                principalTable: "work_orders",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_requisitions_work_orders_work_order_id",
                table: "requisitions",
                column: "work_order_id",
                principalTable: "work_orders",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_purchase_orders_work_orders_work_order_id",
                table: "purchase_orders");

            migrationBuilder.DropForeignKey(
                name: "fk_requisitions_work_orders_work_order_id",
                table: "requisitions");

            migrationBuilder.DropTable(
                name: "work_orders");

            migrationBuilder.DropIndex(
                name: "ix_requisitions_work_order_id",
                table: "requisitions");

            migrationBuilder.DropIndex(
                name: "ix_purchase_orders_work_order_id",
                table: "purchase_orders");

            migrationBuilder.DropColumn(
                name: "work_order_id",
                table: "requisitions");

            migrationBuilder.DropColumn(
                name: "work_order_id",
                table: "purchase_orders");
        }
    }
}
