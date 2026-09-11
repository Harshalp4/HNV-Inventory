using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SiteStock.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PurchaseOrderSendApproval : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "send_approval",
                table: "purchase_orders",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "send_approval_decided_at",
                table: "purchase_orders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "send_approval_decided_by_id",
                table: "purchase_orders",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "send_approval_note",
                table: "purchase_orders",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_purchase_orders_send_approval_decided_by_id",
                table: "purchase_orders",
                column: "send_approval_decided_by_id");

            migrationBuilder.AddForeignKey(
                name: "fk_purchase_orders_users_send_approval_decided_by_id",
                table: "purchase_orders",
                column: "send_approval_decided_by_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_purchase_orders_users_send_approval_decided_by_id",
                table: "purchase_orders");

            migrationBuilder.DropIndex(
                name: "ix_purchase_orders_send_approval_decided_by_id",
                table: "purchase_orders");

            migrationBuilder.DropColumn(
                name: "send_approval",
                table: "purchase_orders");

            migrationBuilder.DropColumn(
                name: "send_approval_decided_at",
                table: "purchase_orders");

            migrationBuilder.DropColumn(
                name: "send_approval_decided_by_id",
                table: "purchase_orders");

            migrationBuilder.DropColumn(
                name: "send_approval_note",
                table: "purchase_orders");
        }
    }
}
