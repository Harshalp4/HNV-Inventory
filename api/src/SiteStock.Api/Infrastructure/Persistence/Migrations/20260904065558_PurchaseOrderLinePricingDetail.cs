using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SiteStock.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PurchaseOrderLinePricingDetail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "supplier_note",
                table: "requisitions",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "discount_percent",
                table: "requisition_lines",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "list_rate",
                table: "requisition_lines",
                type: "numeric(14,4)",
                precision: 14,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "make",
                table: "requisition_lines",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "product_code",
                table: "requisition_lines",
                type: "character varying(48)",
                maxLength: 48,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "notes",
                table: "purchase_orders",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "discount_percent",
                table: "purchase_order_lines",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "list_rate",
                table: "purchase_order_lines",
                type: "numeric(14,4)",
                precision: 14,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "make",
                table: "purchase_order_lines",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "product_code",
                table: "purchase_order_lines",
                type: "character varying(48)",
                maxLength: 48,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "supplier_note",
                table: "requisitions");

            migrationBuilder.DropColumn(
                name: "discount_percent",
                table: "requisition_lines");

            migrationBuilder.DropColumn(
                name: "list_rate",
                table: "requisition_lines");

            migrationBuilder.DropColumn(
                name: "make",
                table: "requisition_lines");

            migrationBuilder.DropColumn(
                name: "product_code",
                table: "requisition_lines");

            migrationBuilder.DropColumn(
                name: "notes",
                table: "purchase_orders");

            migrationBuilder.DropColumn(
                name: "discount_percent",
                table: "purchase_order_lines");

            migrationBuilder.DropColumn(
                name: "list_rate",
                table: "purchase_order_lines");

            migrationBuilder.DropColumn(
                name: "make",
                table: "purchase_order_lines");

            migrationBuilder.DropColumn(
                name: "product_code",
                table: "purchase_order_lines");
        }
    }
}
