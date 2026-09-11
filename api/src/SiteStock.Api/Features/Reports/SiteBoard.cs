using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Contracts;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Reports;

/// <param name="Severity">bad or watch. There is no "good" risk.</param>
/// <param name="Route">Where to go to deal with it. Every risk on this board is actionable.</param>
public record SiteRisk(string Key, string Label, int Count, string Severity, string Route);

/// <param name="Tone">ok, watch or bad — the worst of the site's risks.</param>
/// <param name="TotalRequests">Every requisition ever raised here, so the board ties out
/// against the list it links to. A count that cannot be reconciled with the screen behind
/// it reads as wrong even when it is right.</param>
/// <param name="TotalOrders">Every order except cancelled ones, for the same reason.</param>
public record SiteBoardRow(
    Guid SiteId, string Code, string Name,
    int ToPrice, int ToApprove, int TotalRequests,
    int OrdersOut, int OrdersOverdue, int TotalOrders,
    int DeliveriesDue, int DeliveriesOpen,
    decimal StockValue, int LowStock,
    decimal LossesThisMonth,
    decimal Committed, decimal ContractValue, double PercentCommitted,
    bool SeesMoney,
    IReadOnlyList<SiteRisk> Risks,
    string Tone);

/// <summary>
/// Every site on one board, with what is going wrong on each named rather than implied.
///
/// <para>A company-wide total tells an owner nothing he can act on: ₹4 lakh committed is not
/// a decision. "Belvedere B has two orders a week overdue and is at 94% of its contract" is.
/// So the board is per site, every figure links to the list behind it, and the risks are
/// counted and named — a red badge that does not say what is red is decoration.</para>
///
/// <para>Assembled from a fixed number of grouped queries rather than one per site: five
/// sites must not mean forty round trips, and neither must fifty.</para>
/// </summary>
public sealed class SiteBoardService(SiteStockDbContext db, ICurrentUser me, TimeProvider clock)
{
    public async Task<IReadOnlyList<SiteBoardRow>> BuildAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        var weekOut = today.AddDays(7);
        var monthStart = new DateTimeOffset(new DateTime(now.Year, now.Month, 1), TimeSpan.Zero);
        var sites = me.HasAllSites ? null : me.SiteIds.ToList();

        var seesMoney = me.Can(Permissions.PricesRead);

        var rows = await db.Sites.AsNoTracking()
            .Where(s => s.IsActive)
            .Where(s => sites == null || sites.Contains(s.Id))
            .Select(s => new { s.Id, s.Code, s.Name })
            .OrderBy(s => s.Name)
            .ToListAsync(ct);

        if (rows.Count == 0) return [];

        var ids = rows.Select(r => r.Id).ToList();

        // ── one grouped query per fact ───────────────────────────────────────

        var requests = await db.Requisitions.AsNoTracking()
            .Where(r => ids.Contains(r.SiteId))
            .GroupBy(r => new { r.SiteId, r.Status })
            .Select(g => new { g.Key.SiteId, g.Key.Status, Count = g.Count() })
            .ToListAsync(ct);

        var orders = await db.PurchaseOrders.AsNoTracking()
            .Where(o => ids.Contains(o.SiteId) && o.Status != PurchaseOrderStatus.Cancelled)
            .GroupBy(o => o.SiteId)
            .Select(g => new
            {
                SiteId = g.Key,
                Total = g.Count(),
                // Sent and still waiting on the supplier — the ones somebody is chasing.
                Out = g.Count(o => o.Status == PurchaseOrderStatus.Sent
                                   || o.Status == PurchaseOrderStatus.PartiallyReceived),
                Overdue = g.Count(o => (o.Status == PurchaseOrderStatus.Sent
                                        || o.Status == PurchaseOrderStatus.PartiallyReceived)
                                       && o.ExpectedDelivery < today),
                DueSoon = g.Count(o => (o.Status == PurchaseOrderStatus.Sent
                                        || o.Status == PurchaseOrderStatus.PartiallyReceived)
                                       && o.ExpectedDelivery >= today && o.ExpectedDelivery <= weekOut),
            })
            .ToListAsync(ct);

        var openReceipts = await db.GoodsReceipts.AsNoTracking()
            .Where(g => ids.Contains(g.SiteId) && g.Status == GoodsReceiptStatus.Draft)
            .GroupBy(g => g.SiteId)
            .Select(g => new { SiteId = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var losses = await db.StockMovements.AsNoTracking()
            .Where(m => ids.Contains(m.SiteId) && m.OccurredAt >= monthStart)
            .Where(m => m.Reason != null
                        && m.Reason != AdjustmentReason.FoundExtra
                        && m.Reason != AdjustmentReason.EntryError
                        && m.Reason != AdjustmentReason.Miscount)
            .Where(m => m.Type == MovementType.WrittenOff
                        || (m.Type == MovementType.Adjustment && m.Quantity < 0))
            .Select(m => new { m.SiteId, m.MaterialId, m.Quantity })
            .ToListAsync(ct);

        var balances = await db.StockMovements.AsNoTracking()
            .Where(m => ids.Contains(m.SiteId))
            .GroupBy(m => new { m.SiteId, m.MaterialId })
            .Select(g => new { g.Key.SiteId, g.Key.MaterialId, Quantity = g.Sum(m => m.Quantity) })
            .ToListAsync(ct);

        var reorderLevels = await db.StockSettings.AsNoTracking()
            .Where(s => s.AlertsEnabled && ids.Contains(s.SiteId))
            .Select(s => new { s.SiteId, s.MaterialId, s.ReorderLevel })
            .ToListAsync(ct);

        var jobs = await db.WorkOrders.AsNoTracking()
            .Where(w => ids.Contains(w.SiteId) && w.Status == WorkOrderStatus.Active)
            .Select(w => new
            {
                w.SiteId,
                w.ContractValue,
                Committed = db.PurchaseOrders
                    .Where(o => o.WorkOrderId == w.Id && o.Status != PurchaseOrderStatus.Cancelled)
                    .Sum(o => (decimal?)o.GrandTotal) ?? 0m,
            })
            .ToListAsync(ct);

        // Last rate paid, for valuing what is on the ground. Materials never bought have no
        // rate, so they count as nothing rather than as a guess.
        var materialIds = balances.Select(b => b.MaterialId)
            .Concat(losses.Select(l => l.MaterialId)).Distinct().ToList();

        var rates = await db.PurchaseOrderLines.AsNoTracking()
            .Where(l => materialIds.Contains(l.MaterialId)
                        && l.PurchaseOrder.Status != PurchaseOrderStatus.Cancelled)
            .GroupBy(l => l.MaterialId)
            .Select(g => new
            {
                Material = g.Key,
                Rate = g.OrderByDescending(l => l.PurchaseOrder.IssuedAt).Select(l => l.UnitRate).First(),
            })
            .ToDictionaryAsync(x => x.Material, x => x.Rate, ct);

        decimal Rate(Guid material) => rates.TryGetValue(material, out var r) ? r : 0m;

        // ── assemble ─────────────────────────────────────────────────────────

        return rows.Select(site =>
        {
            var id = site.Id;

            var siteRequests = requests.Where(r => r.SiteId == id).ToList();
            var toPrice = siteRequests.FirstOrDefault(r => r.Status == RequisitionStatus.Submitted)?.Count ?? 0;
            var toApprove = siteRequests.FirstOrDefault(r => r.Status == RequisitionStatus.Priced)?.Count ?? 0;
            var totalRequests = siteRequests.Sum(r => r.Count);

            var order = orders.FirstOrDefault(o => o.SiteId == id);
            var open = openReceipts.FirstOrDefault(g => g.SiteId == id)?.Count ?? 0;

            var stock = balances.Where(b => b.SiteId == id && b.Quantity > 0)
                .Sum(b => b.Quantity * Rate(b.MaterialId));

            var lost = losses.Where(l => l.SiteId == id)
                .Sum(l => Math.Abs(l.Quantity) * Rate(l.MaterialId));

            var low = reorderLevels.Count(s =>
                s.SiteId == id
                && (balances.FirstOrDefault(b => b.SiteId == id && b.MaterialId == s.MaterialId)
                        is not { } balance || balance.Quantity <= s.ReorderLevel));

            var siteJobs = jobs.Where(j => j.SiteId == id).ToList();
            var contract = siteJobs.Sum(j => j.ContractValue);
            var committed = siteJobs.Sum(j => j.Committed);
            var percent = contract == 0 ? 0d : (double)Math.Round(committed / contract * 100m, 1);

            // ── the risks, named ─────────────────────────────────────────────
            var risks = new List<SiteRisk>();

            if (order?.Overdue > 0)
                risks.Add(new("overdue", "Deliveries past their date", order.Overdue, "bad", "/purchase-orders"));

            if (open > 0)
                risks.Add(new("open-grn", "Deliveries left part-counted", open, "watch", "/deliveries"));

            if (low > 0)
                risks.Add(new("low-stock", "Materials at or below reorder level", low, "watch", "/stock"));

            if (toApprove > 0)
                risks.Add(new("to-approve", "Requests waiting for approval", toApprove, "watch", "/requisitions"));

            if (seesMoney && lost > 0)
                risks.Add(new("losses", "Stock written off this month", 1, "bad", "/reports"));

            if (seesMoney && contract > 0 && percent >= 100)
                risks.Add(new("over-budget", "Job spend past the contract value", 1, "bad", "/reports"));
            else if (seesMoney && contract > 0 && percent >= 80)
                risks.Add(new("near-budget", "Job spend past 80% of the contract", 1, "watch", "/reports"));

            var tone = risks.Any(r => r.Severity == "bad") ? "bad"
                : risks.Count > 0 ? "watch"
                : "ok";

            return new SiteBoardRow(
                id, site.Code, site.Name,
                toPrice, toApprove, totalRequests,
                order?.Out ?? 0, order?.Overdue ?? 0, order?.Total ?? 0,
                order?.DueSoon ?? 0, open,
                Math.Round(stock, 2), low,
                Math.Round(lost, 2),
                committed, contract, percent,
                seesMoney,
                risks, tone);
        }).ToList();
    }
}
