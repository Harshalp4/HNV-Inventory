using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SiteStock.Api.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Purchase orders now carry the company's own prefix — <c>HNP-BLB-0001</c>, not
    /// <c>PO-BLB-0001</c> — because that is the number the supplier files the order under.
    ///
    /// Orders already issued are renamed with it. Leaving them on the old prefix would split
    /// the register in two, and a purchase order register you cannot read straight through is
    /// a conversation nobody wants to have with an auditor. The counter moves across with
    /// them, so the next order continues the sequence rather than restarting at one.
    /// </summary>
    public partial class PurchaseOrderNumberPrefix : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE purchase_orders SET number = 'HNP-' || substring(number from 4)
                WHERE number LIKE 'PO-%';
                """);

            migrationBuilder.Sql(
                """
                UPDATE document_numbers SET scope = 'HNP-' || substring(scope from 4)
                WHERE scope LIKE 'PO-%';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE purchase_orders SET number = 'PO-' || substring(number from 5)
                WHERE number LIKE 'HNP-%';
                """);

            migrationBuilder.Sql(
                """
                UPDATE document_numbers SET scope = 'PO-' || substring(scope from 5)
                WHERE scope LIKE 'HNP-%';
                """);
        }
    }
}
