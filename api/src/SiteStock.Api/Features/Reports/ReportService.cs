using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Billing;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Reports;

public record SupplierScoreRow(
    Guid SupplierId, string SupplierName,
    int OrdersPlaced, decimal TotalOrdered, decimal TotalReceived,
    int DeliveriesTaken, int DeliveriesOnTime, int DeliveriesRejected,
    /// <summary>Arrived on or before the expected date, as a percentage of deliveries taken.</summary>
    double OnTimePercent,
    /// <summary>Deliveries refused outright, as a percentage.</summary>
    double RejectionPercent,
    /// <summary>Days from order to first delivery, averaged.</summary>
    double? AverageLeadDays,
    /// <summary>Rupees billed above what was owed, across all their invoices.</summary>
    decimal OverBilled,
    int InvoicesWithVariance);

public record SpendRow(string Key, string Label, decimal Amount, int OrderCount);

public record ConsumptionRow(
    Guid MaterialId, string MaterialName, string UnitCode,
    decimal TotalUsed, decimal AveragePerDay, int DaysWithUse);

public record ReportsSummary(
    decimal CommittedThisYear, decimal ReceivedThisYear,
    int OpenOrders, int OpenVariances, decimal HeldBack,
    int LowStockMaterials, int OpenTransfers);

/// <summary>
/// The numbers somebody will be asked for by an auditor, a bank, or a supplier arguing
/// about their record.
///
/// <para>Everything here is derived from what the workflow already recorded — there is no
/// separate reporting write path, so a figure on a report and the same figure on a screen
/// cannot disagree.</para>
/// </summary>
public sealed class ReportService(SiteStockDbContext db, ICurrentUser me, TimeProvider clock)
{
    /// <summary>
    /// Supplier performance, computed from receipts rather than opinion.
    ///
    /// <para>On time means the delivery was taken on or before the date the order asked for.
    /// Rejection means the whole load was refused at the gate. Both come from what a
    /// supervisor recorded while a lorry was standing there, which is why they are worth
    /// something.</para>
    /// </summary>
    public async Task<IReadOnlyList<SupplierScoreRow>> SupplierScoresAsync(
        DateOnly from, DateOnly to, CancellationToken ct)
    {
        var (start, end) = Bounds(from, to);
        var siteFilter = PermittedSites();

        var orderQuery = db.PurchaseOrders.AsNoTracking()
            .Where(o => o.IssuedAt >= start && o.IssuedAt < end
                        && o.Status != PurchaseOrderStatus.Cancelled);

        if (siteFilter is not null)
            orderQuery = orderQuery.Where(o => siteFilter.Contains(o.SiteId));

        var orders = await orderQuery
            .Select(o => new
            {
                o.Id, o.SupplierId, o.Supplier.Name, o.GrandTotal, o.IssuedAt, o.ExpectedDelivery,
            })
            .ToListAsync(ct);

        if (orders.Count == 0) return [];

        var orderIds = orders.Select(o => o.Id).ToList();

        var receipts = await db.GoodsReceipts.AsNoTracking()
            .Where(g => orderIds.Contains(g.PurchaseOrderId)
                        && g.Status != GoodsReceiptStatus.Draft)
            .Select(g => new
            {
                g.PurchaseOrderId, g.Status, g.ReceivedAt,
                Value = g.Lines.Sum(l => l.AcceptedQuantity * l.PurchaseOrderLine.UnitRate),
            })
            .ToListAsync(ct);

        var variances = await db.InvoiceVariances.AsNoTracking()
            .Where(v => v.Invoice.PurchaseOrder.IssuedAt >= start
                        && v.Invoice.PurchaseOrder.IssuedAt < end
                        && v.Type != VarianceType.DuplicateInvoice)
            .Select(v => new { v.Invoice.SupplierId, v.InvoiceId, v.DifferenceAmount })
            .ToListAsync(ct);

        var byOrder = orders.ToDictionary(o => o.Id);

        return orders
            .GroupBy(o => new { o.SupplierId, o.Name })
            .Select(group =>
            {
                var ids = group.Select(o => o.Id).ToHashSet();
                var theirReceipts = receipts.Where(r => ids.Contains(r.PurchaseOrderId)).ToList();

                var taken = theirReceipts.Count;
                var rejected = theirReceipts.Count(r => r.Status == GoodsReceiptStatus.Rejected);

                var onTime = theirReceipts.Count(r =>
                    byOrder.TryGetValue(r.PurchaseOrderId, out var order)
                    && DateOnly.FromDateTime(r.ReceivedAt.UtcDateTime) <= order.ExpectedDelivery);

                // First delivery only: a second lorry for the balance says nothing about
                // how quickly they responded to the order.
                var leadDays = theirReceipts
                    .GroupBy(r => r.PurchaseOrderId)
                    .Select(g => g.OrderBy(r => r.ReceivedAt).First())
                    .Where(r => byOrder.ContainsKey(r.PurchaseOrderId))
                    .Select(r => (r.ReceivedAt - byOrder[r.PurchaseOrderId].IssuedAt).TotalDays)
                    .ToList();

                var theirVariances = variances.Where(v => v.SupplierId == group.Key.SupplierId).ToList();

                return new SupplierScoreRow(
                    group.Key.SupplierId, group.Key.Name,
                    group.Count(), group.Sum(o => o.GrandTotal),
                    Math.Round(theirReceipts.Sum(r => r.Value), 2),
                    taken, onTime, rejected,
                    taken > 0 ? Math.Round(onTime * 100d / taken, 1) : 0d,
                    taken > 0 ? Math.Round(rejected * 100d / taken, 1) : 0d,
                    leadDays.Count > 0 ? Math.Round(leadDays.Average(), 1) : null,
                    Math.Round(theirVariances.Where(v => v.DifferenceAmount > 0).Sum(v => v.DifferenceAmount), 2),
                    theirVariances.Select(v => v.InvoiceId).Distinct().Count());
            })
            .OrderByDescending(r => r.TotalOrdered)
            .ToList();
    }

    /// <summary>Committed spend grouped by site, supplier, material category or month.</summary>
    public async Task<IReadOnlyList<SpendRow>> SpendAsync(
        string groupBy, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var (start, end) = Bounds(from, to);
        var siteFilter = PermittedSites();

        var orders = db.PurchaseOrders.AsNoTracking()
            .Where(o => o.IssuedAt >= start && o.IssuedAt < end
                        && o.Status != PurchaseOrderStatus.Cancelled);

        if (siteFilter is not null)
            orders = orders.Where(o => siteFilter.Contains(o.SiteId));

        // Grouping keys are read as flat columns and the rows are grouped here rather than
        // in SQL. A key that reaches through a navigation — o.Site.Name — needs a join inside
        // the GROUP BY, which EF will not translate. At a few hundred orders in a period the
        // difference is unmeasurable, and this always works.
        switch (groupBy?.ToLowerInvariant())
        {
            case "supplier":
            {
                var rows = await orders
                    .Select(o => new { o.SupplierId, Name = o.Supplier.Name, o.GrandTotal })
                    .ToListAsync(ct);

                return rows
                    .GroupBy(o => new { o.SupplierId, o.Name })
                    .Select(g => new SpendRow(
                        g.Key.SupplierId.ToString(), g.Key.Name, g.Sum(o => o.GrandTotal), g.Count()))
                    .OrderByDescending(r => r.Amount)
                    .ToList();
            }

            case "month":
                var months = await orders
                    .GroupBy(o => new { o.IssuedAt.Year, o.IssuedAt.Month })
                    .Select(g => new
                    {
                        g.Key.Year, g.Key.Month,
                        Amount = g.Sum(o => o.GrandTotal), Count = g.Count(),
                    })
                    .ToListAsync(ct);

                return months
                    .OrderBy(m => m.Year).ThenBy(m => m.Month)
                    .Select(m => new SpendRow(
                        $"{m.Year}-{m.Month:00}",
                        new DateTime(m.Year, m.Month, 1).ToString("MMM yyyy"),
                        m.Amount, m.Count))
                    .ToList();

            case "category":
            {
                // From the order lines, so a mixed order splits across categories rather
                // than landing wholly under whichever one happens to come first.
                var lines = db.PurchaseOrderLines.AsNoTracking()
                    .Where(l => l.PurchaseOrder.IssuedAt >= start && l.PurchaseOrder.IssuedAt < end
                                && l.PurchaseOrder.Status != PurchaseOrderStatus.Cancelled);

                if (siteFilter is not null)
                    lines = lines.Where(l => siteFilter.Contains(l.PurchaseOrder.SiteId));

                var rows = await lines
                    .Select(l => new
                    {
                        Category = l.Material.Category,
                        Amount = l.LineTotal + l.TaxAmount,
                        l.PurchaseOrderId,
                    })
                    .ToListAsync(ct);

                return rows
                    .GroupBy(l => l.Category)
                    .Select(g => new SpendRow(
                        g.Key, g.Key, g.Sum(l => l.Amount),
                        g.Select(l => l.PurchaseOrderId).Distinct().Count()))
                    .OrderByDescending(r => r.Amount)
                    .ToList();
            }

            default:
            {
                var rows = await orders
                    .Select(o => new { o.SiteId, Name = o.Site.Name, o.GrandTotal })
                    .ToListAsync(ct);

                return rows
                    .GroupBy(o => new { o.SiteId, o.Name })
                    .Select(g => new SpendRow(
                        g.Key.SiteId.ToString(), g.Key.Name, g.Sum(o => o.GrandTotal), g.Count()))
                    .OrderByDescending(r => r.Amount)
                    .ToList();
            }
        }
    }

    public async Task<IReadOnlyList<ConsumptionRow>> ConsumptionAsync(
        Guid? siteId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var siteFilter = PermittedSites();

        if (siteId is { } id && !me.CanSeeSite(id))
            throw AppException.Forbidden("You do not have access to that site.");

        var records = db.ConsumptionRecords.AsNoTracking()
            .Where(c => c.UsedOn >= from && c.UsedOn <= to);

        if (siteId is { } only) records = records.Where(c => c.SiteId == only);
        if (siteFilter is not null) records = records.Where(c => siteFilter.Contains(c.SiteId));

        var flat = await records
            .Select(c => new
            {
                c.MaterialId,
                Name = c.Material.Name,
                Code = c.Material.Unit.Code,
                c.Quantity,
                c.UsedOn,
            })
            .ToListAsync(ct);

        var rows = flat
            .GroupBy(c => new { c.MaterialId, c.Name, c.Code })
            .Select(g => new
            {
                g.Key.MaterialId, g.Key.Name, g.Key.Code,
                Total = g.Sum(c => c.Quantity),
                Days = g.Select(c => c.UsedOn).Distinct().Count(),
            })
            .ToList();

        var span = Math.Max(1, to.DayNumber - from.DayNumber + 1);

        return rows
            .Select(r => new ConsumptionRow(
                r.MaterialId, r.Name, r.Code, r.Total,
                Math.Round(r.Total / span, 3), r.Days))
            .OrderByDescending(r => r.TotalUsed)
            .ToList();
    }

    /// <summary>The handful of figures worth seeing before choosing a report.</summary>
    public async Task<ReportsSummary> SummaryAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var startYear = now.Month >= 4 ? now.Year : now.Year - 1;
        var start = new DateTimeOffset(startYear, 4, 1, 0, 0, 0, TimeSpan.Zero);
        var siteFilter = PermittedSites();

        var orders = db.PurchaseOrders.AsNoTracking()
            .Where(o => o.Status != PurchaseOrderStatus.Cancelled);

        if (siteFilter is not null)
            orders = orders.Where(o => siteFilter.Contains(o.SiteId));

        var committed = await orders.Where(o => o.IssuedAt >= start)
            .SumAsync(o => (decimal?)o.GrandTotal, ct) ?? 0m;

        var receivedLines = db.GoodsReceiptLines.AsNoTracking()
            .Where(l => l.GoodsReceipt.Status == GoodsReceiptStatus.Accepted
                        && l.GoodsReceipt.ReceivedAt >= start);

        if (siteFilter is not null)
            receivedLines = receivedLines.Where(l => siteFilter.Contains(l.GoodsReceipt.SiteId));

        var received = await receivedLines
            .SumAsync(l => (decimal?)(l.AcceptedQuantity * l.PurchaseOrderLine.UnitRate), ct) ?? 0m;

        var openOrders = await orders.CountAsync(
            o => o.Status == PurchaseOrderStatus.Sent
                 || o.Status == PurchaseOrderStatus.PartiallyReceived
                 || o.Status == PurchaseOrderStatus.Issued, ct);

        var varianceQuery = db.InvoiceVariances.AsNoTracking().Where(v => v.ResolvedAt == null);

        if (siteFilter is not null)
            varianceQuery = varianceQuery.Where(v => siteFilter.Contains(v.Invoice.SiteId));

        var openVariances = await varianceQuery.ToListAsync(ct);

        var lowStock = await LowStockCountAsync(ct);

        var transferQuery = db.TransferRequests.AsNoTracking()
            .Where(t => t.Status == Domain.Inventory.TransferStatus.Requested
                        || t.Status == Domain.Inventory.TransferStatus.Approved
                        || t.Status == Domain.Inventory.TransferStatus.InTransit);

        if (siteFilter is not null)
        {
            transferQuery = transferQuery.Where(t =>
                siteFilter.Contains(t.FromSiteId) || siteFilter.Contains(t.ToSiteId));
        }

        var openTransfers = await transferQuery.CountAsync(ct);

        return new ReportsSummary(
            committed, Math.Round(received, 2), openOrders,
            openVariances.Count, openVariances.Sum(v => v.DifferenceAmount),
            lowStock, openTransfers);
    }

    private async Task<int> LowStockCountAsync(CancellationToken ct)
    {
        var siteFilter = PermittedSites();

        var settingQuery = db.StockSettings.AsNoTracking().Where(s => s.AlertsEnabled);

        if (siteFilter is not null)
            settingQuery = settingQuery.Where(s => siteFilter.Contains(s.SiteId));

        var settings = await settingQuery
            .Select(s => new { s.SiteId, s.MaterialId, s.ReorderLevel })
            .ToListAsync(ct);

        if (settings.Count == 0) return 0;

        var movements = db.StockMovements.AsNoTracking();

        if (siteFilter is not null)
            movements = movements.Where(m => siteFilter.Contains(m.SiteId));

        var balances = await movements
            .GroupBy(m => new { m.SiteId, m.MaterialId })
            .Select(g => new { g.Key.SiteId, g.Key.MaterialId, Quantity = g.Sum(m => m.Quantity) })
            .ToListAsync(ct);

        return settings.Count(s =>
            balances.FirstOrDefault(b => b.SiteId == s.SiteId && b.MaterialId == s.MaterialId)
                is not { } balance || balance.Quantity <= s.ReorderLevel);
    }

    /// <summary>Null means every site — an organisation-wide role sees the whole company.</summary>
    private List<Guid>? PermittedSites() =>
        me.HasAllSites ? null : me.SiteIds.ToList();

    private static (DateTimeOffset Start, DateTimeOffset End) Bounds(DateOnly from, DateOnly to) =>
        (new DateTimeOffset(from.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero),
         new DateTimeOffset(to.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero));
}
