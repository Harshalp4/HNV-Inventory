using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SiteStock.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PurchaseOrderCancelledBy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "cancelled_by_id",
                table: "purchase_orders",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_purchase_orders_cancelled_by_id",
                table: "purchase_orders",
                column: "cancelled_by_id");

            migrationBuilder.AddForeignKey(
                name: "fk_purchase_orders_users_cancelled_by_id",
                table: "purchase_orders",
                column: "cancelled_by_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_purchase_orders_users_cancelled_by_id",
                table: "purchase_orders");

            migrationBuilder.DropIndex(
                name: "ix_purchase_orders_cancelled_by_id",
                table: "purchase_orders");

            migrationBuilder.DropColumn(
                name: "cancelled_by_id",
                table: "purchase_orders");
        }
    }
}
