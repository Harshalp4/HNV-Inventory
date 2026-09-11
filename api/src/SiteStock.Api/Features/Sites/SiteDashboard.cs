using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Contracts;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Features.Reports;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Sites;

/// <param name="Month">yyyy-MM, oldest first.</param>
public record SiteSpendPoint(string Month, string Label, decimal Amount, int OrderCount);

/// <param name="Number">The order, so a figure can be chased to the paper behind it.</param>
public record SiteOrderRow(
    Guid Id, string Number, string SupplierName, string Status,
    DateOnly ExpectedDelivery, bool IsLate, decimal? GrandTotal,
    int LineCount, int LinesReceived);

/// <summary>
/// Everything about one site on one screen: what is waiting, what is on the ground, what it
/// has cost, and what is going wrong — with the same figures the reports give, scoped here.
///
/// <para>The board on the home screen answers "which site needs me". This answers "what is
/// happening at this one", which is a different question and needs the detail the board
/// deliberately leaves out.</para>
/// </summary>
public record SiteDashboardDto(
    SiteOverviewDto Overview,
    /// <summary>Committed by month, oldest first — the shape of spending, not just a total.</summary>
    IReadOnlyList<SiteSpendPoint> SpendByMonth,
    IReadOnlyList<SiteOrderRow> OpenOrders,
    IReadOnlyList<JobCostRow> Jobs,
    IReadOnlyList<ConsumptionRow> TopMaterials,
    IReadOnlyList<LossRow> Losses,
    IReadOnlyList<DeadStockRow> IdleStock,
    /// <summary>False for a supervisor: the page still works, the money sections are absent.</summary>
    bool SeesMoney);

public sealed class SiteDashboardService(
    SiteStockDbContext db,
    SiteOverviewService overview,
    CostingReportService costing,
    ReportService reports,
    ICurrentUser me,
    TimeProvider clock)
{
    public async Task<SiteDashboardDto> BuildAsync(
        Guid siteId, DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        if (!me.CanSeeSite(siteId)) throw AppException.Forbidden("You do not work at that site.");

        var end = to ?? DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var start = from ?? end.AddMonths(-6);
        var seesMoney = me.Can(Permissions.PricesRead);
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

        var head = await overview.BuildAsync(siteId, ct);

        // ── orders still open here ───────────────────────────────────────────
        var open = await db.PurchaseOrders.AsNoTracking()
            .Where(o => o.SiteId == siteId)
            .Where(o => o.Status == PurchaseOrderStatus.Issued
                        || o.Status == PurchaseOrderStatus.Sent
                        || o.Status == PurchaseOrderStatus.PartiallyReceived)
            .OrderBy(o => o.ExpectedDelivery)
            .Select(o => new
            {
                o.Id, o.Number, Supplier = o.Supplier.Name, o.Status,
                o.ExpectedDelivery, o.GrandTotal,
                Lines = o.Lines.Count(),
                Received = o.Lines.Count(l =>
                    db.GoodsReceiptLines
                        .Where(rl => rl.PurchaseOrderLineId == l.Id
                                     && rl.GoodsReceipt.Status == GoodsReceiptStatus.Accepted)
                        .Sum(rl => (decimal?)rl.AcceptedQuantity) >= l.Quantity),
            })
            .ToListAsync(ct);

        var openOrders = open.Select(o => new SiteOrderRow(
            o.Id, o.Number, o.Supplier, o.Status.ToString(),
            o.ExpectedDelivery,
            o.ExpectedDelivery < today && o.Status != PurchaseOrderStatus.Issued,
            seesMoney ? o.GrandTotal : null,
            o.Lines, o.Received)).ToList();

        // ── the money sections ───────────────────────────────────────────────
        var spend = new List<SiteSpendPoint>();
        var jobs = new List<JobCostRow>();

        if (seesMoney)
        {
            var startAt = start.ToDateTime(TimeOnly.MinValue).ToUniversalTime();
            var endAt = end.AddDays(1).ToDateTime(TimeOnly.MinValue).ToUniversalTime();

            var byMonth = await db.PurchaseOrders.AsNoTracking()
                .Where(o => o.SiteId == siteId && o.Status != PurchaseOrderStatus.Cancelled)
                .Where(o => o.IssuedAt >= startAt && o.IssuedAt < endAt)
                .Select(o => new { o.IssuedAt, o.GrandTotal })
                .ToListAsync(ct);

            spend = byMonth
                .GroupBy(o => o.IssuedAt.ToString("yyyy-MM"))
                .OrderBy(g => g.Key)
                .Select(g => new SiteSpendPoint(
                    g.Key,
                    DateTime.ParseExact(g.Key, "yyyy-MM", null).ToString("MMM yy"),
                    Math.Round(g.Sum(o => o.GrandTotal), 2),
                    g.Count()))
                .ToList();

            var allJobs = await costing.JobCostsAsync(null, ct);
            var here = await db.WorkOrders.AsNoTracking()
                .Where(w => w.SiteId == siteId)
                .Select(w => w.Id)
                .ToListAsync(ct);

            jobs = allJobs.Where(j => here.Contains(j.WorkOrderId)).ToList();
        }

        // ── stock and losses ─────────────────────────────────────────────────
        var used = me.Can(Permissions.StockRead)
            ? (await reports.ConsumptionAsync(siteId, start, end, ct)).Take(8).ToList()
            : [];

        var losses = me.Can(Permissions.StockRead)
            ? await costing.LossesAsync(siteId, start, end, ct)
            : [];

        var idle = me.Can(Permissions.StockRead)
            ? (await costing.DeadStockAsync(siteId, 45, ct)).Take(8).ToList()
            : [];

        return new SiteDashboardDto(head, spend, openOrders, jobs, used, losses, idle, seesMoney);
    }
}
