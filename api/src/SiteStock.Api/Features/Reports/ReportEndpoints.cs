using System.Globalization;
using System.Text;
using SiteStock.Api.Common.Security;

namespace SiteStock.Api.Features.Reports;

public static class ReportEndpoints
{
    public static IEndpointRouteBuilder MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/reports").WithTags("Reports");

        // The headline figures are committed spend and bills held back — money, all of it.
        group.MapGet("/summary", async (ReportService service, CancellationToken ct) =>
                Results.Ok(await service.SummaryAsync(ct)))
            .RequirePermission(Permissions.PricesRead)
            .WithName("ReportsSummary");

        group.MapGet("/suppliers", async (DateOnly? from, DateOnly? to,
                ReportService service, CancellationToken ct) =>
            {
                var (start, end) = Range(from, to);
                return Results.Ok(await service.SupplierScoresAsync(start, end, ct));
            })
            // Rates and over-billing are in here, so it needs prices.read as well as the
            // supplier list — a supervisor may look up a supplier without reading the ledger.
            .RequirePermission(Permissions.PricesRead)
            .WithName("SupplierScores")
            .WithSummary("On-time delivery, rejections and over-billing, computed from what supervisors recorded at the gate.");

        group.MapGet("/spend", async (string? groupBy, DateOnly? from, DateOnly? to,
                ReportService service, CancellationToken ct) =>
            {
                var (start, end) = Range(from, to);
                return Results.Ok(await service.SpendAsync(groupBy ?? "site", start, end, ct));
            })
            .RequirePermission(Permissions.PricesRead)
            .WithName("SpendReport")
            .WithSummary("groupBy: site · supplier · category · month.");

        group.MapGet("/consumption", async (Guid? siteId, DateOnly? from, DateOnly? to,
                ReportService service, CancellationToken ct) =>
            {
                var (start, end) = Range(from, to);
                return Results.Ok(await service.ConsumptionAsync(siteId, start, end, ct));
            })
            .RequirePermission(Permissions.StockRead)
            .WithName("ConsumptionReport");

        // ── money and loss ───────────────────────────────────────────────────

        group.MapGet("/job-costs", async (string? status,
                CostingReportService service, CancellationToken ct) =>
                Results.Ok(await service.JobCostsAsync(status, ct)))
            .RequirePermission(Permissions.BudgetsRead)
            .WithName("JobCostReport")
            .WithSummary("Contract value against what each job has cost so far.");

        group.MapGet("/losses", async (Guid? siteId, DateOnly? from, DateOnly? to,
                CostingReportService service, CancellationToken ct) =>
            {
                var (start, end) = Range(from, to);
                return Results.Ok(await service.LossesAsync(siteId, start, end, ct));
            })
            .RequirePermission(Permissions.StockRead)
            .WithName("LossReport")
            .WithSummary("Damaged, lost, stolen and wasted stock, by reason and site.");

        group.MapGet("/losses/detail", async (Guid? siteId, DateOnly? from, DateOnly? to,
                CostingReportService service, CancellationToken ct) =>
            {
                var (start, end) = Range(from, to);
                return Results.Ok(await service.LossDetailAsync(siteId, start, end, ct));
            })
            .RequirePermission(Permissions.StockRead)
            .WithName("LossDetailReport")
            .WithSummary("Every write-off, one row each.");

        group.MapGet("/payables", async (CostingReportService service, CancellationToken ct) =>
                Results.Ok(await service.PayablesAsync(ct)))
            .RequirePermission(Permissions.PricesRead)
            .WithName("PayablesReport")
            .WithSummary("Unpaid supplier bills, bucketed by how late they are.");

        group.MapGet("/payables/detail", async (CostingReportService service, CancellationToken ct) =>
                Results.Ok(await service.PayableDetailAsync(ct)))
            .RequirePermission(Permissions.PricesRead)
            .WithName("PayableDetailReport")
            .WithSummary("Each unpaid bill, oldest first.");

        group.MapGet("/rates", async (Guid? materialId, DateOnly? from, DateOnly? to,
                CostingReportService service, CancellationToken ct) =>
            {
                var (start, end) = Range(from, to);
                return Results.Ok(await service.RateHistoryAsync(materialId, start, end, ct));
            })
            .RequirePermission(Permissions.PricesRead)
            .WithName("RateHistoryReport")
            .WithSummary("What a material has cost over time, and who sold it cheapest.");

        group.MapGet("/dead-stock", async (Guid? siteId, int? idleDays,
                CostingReportService service, CancellationToken ct) =>
                Results.Ok(await service.DeadStockAsync(siteId, idleDays ?? 60, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("DeadStockReport")
            .WithSummary("Material on the ground that nothing has been taken from in months.");

        group.MapGet("/cycle-time", async (DateOnly? from, DateOnly? to,
                CostingReportService service, CancellationToken ct) =>
            {
                var (start, end) = Range(from, to);
                return Results.Ok(await service.CycleTimeAsync(start, end, ct));
            })
            .RequirePermission(Permissions.RequisitionsRead)
            .WithName("CycleTimeReport")
            .WithSummary("Where the days go between asking for material and getting it.");

        group.MapGet("/lead-times", async (DateOnly? from, DateOnly? to,
                CostingReportService service, CancellationToken ct) =>
            {
                var (start, end) = Range(from, to);
                return Results.Ok(await service.LeadTimesAsync(start, end, ct));
            })
            .RequirePermission(Permissions.PurchaseOrdersRead)
            .WithName("LeadTimeReport")
            .WithSummary("How long each material actually takes to arrive.");

        // ── who did what ─────────────────────────────────────────────────────
        app.MapGet("/api/people/{userId:guid}/activity", async (Guid userId,
                DateOnly? from, DateOnly? to,
                PersonActivityService service, CancellationToken ct) =>
                Results.Ok(await service.BuildAsync(userId, from, to, ct)))
            .RequireAuthorization()
            .WithTags("Reports")
            .WithName("PersonActivity")
            .WithSummary("What one person did, counted and listed. Anybody may read their own.");

        // ── the dashboard ────────────────────────────────────────────────────
        app.MapGet("/api/dashboard", async (Guid? siteId, DashboardService service, CancellationToken ct) =>
                Results.Ok(await service.BuildAsync(siteId, ct)))
            .RequireAuthorization()
            .WithTags("Reports")
            .WithName("Dashboard")
            .WithSummary("What needs this person today, built from their own permissions.");

        // ── export ───────────────────────────────────────────────────────────
        group.MapGet("/{report}/export", async (string report, string? groupBy, Guid? siteId,
                DateOnly? from, DateOnly? to, ReportService service,
                CostingReportService costing, CancellationToken ct) =>
            {
                var (start, end) = Range(from, to);

                var (name, csv) = report.ToLowerInvariant() switch
                {
                    "suppliers" => ("supplier-performance",
                        Csv(await service.SupplierScoresAsync(start, end, ct),
                            ["Supplier", "Orders", "Ordered", "Received", "Deliveries",
                             "On time", "Rejected", "On time %", "Rejected %", "Avg lead days",
                             "Over-billed", "Bills with differences"],
                            r =>
                            [
                                r.SupplierName, r.OrdersPlaced, r.TotalOrdered, r.TotalReceived,
                                r.DeliveriesTaken, r.DeliveriesOnTime, r.DeliveriesRejected,
                                r.OnTimePercent, r.RejectionPercent, r.AverageLeadDays,
                                r.OverBilled, r.InvoicesWithVariance,
                            ])),

                    "consumption" => ("consumption",
                        Csv(await service.ConsumptionAsync(siteId, start, end, ct),
                            ["Material", "Unit", "Total used", "Average per day", "Days with use"],
                            r => [r.MaterialName, r.UnitCode, r.TotalUsed, r.AveragePerDay, r.DaysWithUse])),

                    "job-costs" => ("job-costs",
                        Csv(await costing.JobCostsAsync(null, ct),
                            ["Work order", "Title", "Client", "Site", "Status",
                             "Contract value", "Committed", "Received", "Margin", "Margin %", "Committed %"],
                            r =>
                            [
                                r.Number, r.Title, r.ClientName, r.SiteName, r.Status,
                                r.ContractValue, r.Committed, r.Received, r.Margin,
                                r.MarginPercent, r.PercentCommitted,
                            ])),

                    "losses" => ("losses",
                        Csv(await costing.LossDetailAsync(siteId, start, end, ct),
                            ["When", "Site", "Material", "Unit", "Reason", "Quantity", "Value", "Recorded by", "Notes"],
                            r =>
                            [
                                r.OccurredAt, r.SiteName, r.MaterialName, r.UnitCode,
                                r.Reason, r.Quantity, r.Value, r.RecordedByName, r.Notes,
                            ])),

                    "payables" => ("payables",
                        Csv(await costing.PayableDetailAsync(ct),
                            ["Bill", "Supplier", "Order", "Invoice date", "Due", "Days late", "Amount", "Status", "Has a difference"],
                            r =>
                            [
                                r.SupplierInvoiceNumber, r.SupplierName, r.PurchaseOrderNumber,
                                r.InvoiceDate, r.DueDate, r.DaysLate, r.PayableAmount,
                                r.Status, r.HasOpenVariance ? "Yes" : "No",
                            ])),

                    "rates" => ("rates-paid",
                        Csv(await costing.RateHistoryAsync(null, start, end, ct),
                            ["Code", "Material", "Unit", "First rate", "Last rate", "Lowest", "Highest", "Change %", "Orders"],
                            r =>
                            [
                                r.MaterialCode, r.MaterialName, r.UnitCode, r.FirstRate,
                                r.LastRate, r.LowestRate, r.HighestRate, r.ChangePercent, r.OrderCount,
                            ])),

                    "dead-stock" => ("dead-stock",
                        Csv(await costing.DeadStockAsync(siteId, 60, ct),
                            ["Site", "Material", "Unit", "On hand", "Value", "Days since it moved"],
                            r => [r.SiteName, r.MaterialName, r.UnitCode, r.OnHand, r.Value, r.DaysSinceMoved])),

                    "lead-times" => ("lead-times",
                        Csv(await costing.LeadTimesAsync(start, end, ct),
                            ["Material", "Unit", "Average days", "Slowest days", "Deliveries", "Slowest supplier"],
                            r => [r.MaterialName, r.UnitCode, r.AverageLeadDays, r.SlowestLeadDays, r.Deliveries, r.SlowestSupplier])),

                    _ => ("spend",
                        Csv(await service.SpendAsync(groupBy ?? "site", start, end, ct),
                            [Heading(groupBy), "Amount", "Orders"],
                            r => [r.Label, r.Amount, r.OrderCount])),
                };

                return Results.File(
                    Encoding.UTF8.GetBytes(csv), "text/csv",
                    $"{name}-{start:yyyy-MM-dd}-to-{end:yyyy-MM-dd}.csv");
            })
            // Two of the three exports are money, and a CSV leaves the building. Gated on
            // the stricter of the two rather than per report name.
            .RequirePermission(Permissions.PricesRead)
            .WithName("ExportReport")
            .WithSummary("CSV, which every accounts department can open. Finance asks for this on day one.");

        return app;
    }

    private static string Heading(string? groupBy) => groupBy?.ToLowerInvariant() switch
    {
        "supplier" => "Supplier",
        "category" => "Category",
        "month" => "Month",
        _ => "Site",
    };

    /// <summary>Last twelve months by default — long enough to see a pattern.</summary>
    private static (DateOnly From, DateOnly To) Range(DateOnly? from, DateOnly? to)
    {
        var end = to ?? DateOnly.FromDateTime(DateTime.UtcNow);
        return (from ?? end.AddYears(-1), end);
    }

    private static string Csv<T>(
        IEnumerable<T> rows, string[] headings, Func<T, object?[]> select)
    {
        var builder = new StringBuilder();

        // Excel on a machine set to India reads a bare UTF-8 CSV as Latin-1 and mangles the
        // rupee sign; the byte order mark tells it otherwise.
        builder.Append('﻿');
        builder.AppendLine(string.Join(',', headings.Select(Escape)));

        foreach (var row in rows)
            builder.AppendLine(string.Join(',', select(row).Select(Format).Select(Escape)));

        return builder.ToString();
    }

    private static string Format(object? value) => value switch
    {
        null => string.Empty,
        decimal money => money.ToString("0.00", CultureInfo.InvariantCulture),
        double number => number.ToString("0.##", CultureInfo.InvariantCulture),
        DateOnly date => date.ToString("yyyy-MM-dd"),
        _ => value.ToString() ?? string.Empty,
    };

    private static string Escape(string value) =>
        value.Contains(',') || value.Contains('"') || value.Contains('\n')
            ? $"\"{value.Replace("\"", "\"\"")}\""
            : value;
}
