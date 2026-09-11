using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SiteStock.Api.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InterSiteTransfers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "transfer_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    from_site_id = table.Column<Guid>(type: "uuid", nullable: false),
                    to_site_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    requested_by_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    needed_by = table.Column<DateOnly>(type: "date", nullable: true),
                    decided_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    decided_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    decision_notes = table.Column<string>(type: "character varying(600)", maxLength: 600, nullable: true),
                    dispatched_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    dispatched_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    vehicle_number = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    received_by_id = table.Column<Guid>(type: "uuid", nullable: true),
                    transport_cost = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: true),
                    notes = table.Column<string>(type: "character varying(600)", maxLength: 600, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_transfer_requests", x => x.id);
                    table.ForeignKey(
                        name: "fk_transfer_requests_sites_from_site_id",
                        column: x => x.from_site_id,
                        principalTable: "sites",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transfer_requests_sites_to_site_id",
                        column: x => x.to_site_id,
                        principalTable: "sites",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transfer_requests_users_decided_by_id",
                        column: x => x.decided_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transfer_requests_users_dispatched_by_id",
                        column: x => x.dispatched_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transfer_requests_users_received_by_id",
                        column: x => x.received_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transfer_requests_users_requested_by_id",
                        column: x => x.requested_by_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "transfer_lines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    transfer_request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    material_id = table.Column<Guid>(type: "uuid", nullable: false),
                    requested_quantity = table.Column<decimal>(type: "numeric(14,3)", precision: 14, scale: 3, nullable: false),
                    approved_quantity = table.Column<decimal>(type: "numeric(14,3)", precision: 14, scale: 3, nullable: true),
                    dispatched_quantity = table.Column<decimal>(type: "numeric(14,3)", precision: 14, scale: 3, nullable: true),
                    received_quantity = table.Column<decimal>(type: "numeric(14,3)", precision: 14, scale: 3, nullable: true),
                    unit_value = table.Column<decimal>(type: "numeric(14,4)", precision: 14, scale: 4, nullable: true),
                    notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_transfer_lines", x => x.id);
                    table.ForeignKey(
                        name: "fk_transfer_lines_materials_material_id",
                        column: x => x.material_id,
                        principalTable: "materials",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_transfer_lines_transfer_requests_transfer_request_id",
                        column: x => x.transfer_request_id,
                        principalTable: "transfer_requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_transfer_lines_material_id",
                table: "transfer_lines",
                column: "material_id");

            migrationBuilder.CreateIndex(
                name: "ix_transfer_lines_transfer_request_id_material_id",
                table: "transfer_lines",
                columns: new[] { "transfer_request_id", "material_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_transfer_requests_decided_by_id",
                table: "transfer_requests",
                column: "decided_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_transfer_requests_dispatched_by_id",
                table: "transfer_requests",
                column: "dispatched_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_transfer_requests_from_site_id_status",
                table: "transfer_requests",
                columns: new[] { "from_site_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_transfer_requests_number",
                table: "transfer_requests",
                column: "number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_transfer_requests_received_by_id",
                table: "transfer_requests",
                column: "received_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_transfer_requests_requested_by_id",
                table: "transfer_requests",
                column: "requested_by_id");

            migrationBuilder.CreateIndex(
                name: "ix_transfer_requests_to_site_id_status",
                table: "transfer_requests",
                columns: new[] { "to_site_id", "status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "transfer_lines");

            migrationBuilder.DropTable(
                name: "transfer_requests");
        }
    }
}
