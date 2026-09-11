using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SiteStock.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ClientWorkOrderFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "amendment_version",
                table: "work_orders",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "billing_address",
                table: "work_orders",
                type: "character varying(400)",
                maxLength: 400,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "cgst_amount",
                table: "work_orders",
                type: "numeric(16,2)",
                precision: 16,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "client_address",
                table: "work_orders",
                type: "character varying(400)",
                maxLength: 400,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "client_contact_name",
                table: "work_orders",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "client_contact_phone",
                table: "work_orders",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "client_gstin",
                table: "work_orders",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "discount_amount",
                table: "work_orders",
                type: "numeric(16,2)",
                precision: 16,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "igst_amount",
                table: "work_orders",
                type: "numeric(16,2)",
                precision: 16,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ordered_on",
                table: "work_orders",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "payment_terms",
                table: "work_orders",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "project_name",
                table: "work_orders",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "sgst_amount",
                table: "work_orders",
                type: "numeric(16,2)",
                precision: 16,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "sac_hsn_code",
                table: "work_order_lines",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "section",
                table: "work_order_lines",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "tax_percent",
                table: "work_order_lines",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "amendment_version",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "billing_address",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "cgst_amount",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "client_address",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "client_contact_name",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "client_contact_phone",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "client_gstin",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "discount_amount",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "igst_amount",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "ordered_on",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "payment_terms",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "project_name",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "sgst_amount",
                table: "work_orders");

            migrationBuilder.DropColumn(
                name: "sac_hsn_code",
                table: "work_order_lines");

            migrationBuilder.DropColumn(
                name: "section",
                table: "work_order_lines");

            migrationBuilder.DropColumn(
                name: "tax_percent",
                table: "work_order_lines");
        }
    }
}
