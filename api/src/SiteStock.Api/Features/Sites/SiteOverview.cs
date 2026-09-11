using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Billing;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Features.Budgets;
using SiteStock.Api.Features.Inventory;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Sites;

/// <summary>One thing that needs somebody, with enough detail to decide whether it is you.</summary>
/// <param name="Group">
/// Which kind of work this is — Buying, Approving, Receiving, Money, Stock. Named by the
/// API so the screen groups by the same rule the dashboard does, rather than each screen
/// inventing its own.
/// </param>
public record SiteAlert(
    string Kind, string Title, string Detail, string Link, string Tone, int Count,
    string Group = "Buying");

public record SiteMoney(string FinancialYear, decimal Allocated, decimal Committed,
    decimal Remaining, double PercentUsed);

public record SiteStockLine(string MaterialName, string UnitCode, decimal Quantity,
    decimal? ReorderLevel, double? DaysOfCover);

public record SiteDelivery(Guid Id, string Number, string SupplierName, DateTimeOffset ReceivedAt,
    int LineCount, bool HadTrouble);

public record SitePerson(Guid UserId, string FullName, string RoleName);

/// <summary>
/// Everything about one site on one screen.
///
/// <para>Assembled server-side rather than by the browser firing eight requests: a site
/// manager on a phone at the gate gets one round trip, and the numbers are all read from the
/// same instant rather than drifting apart as the responses land.</para>
///
/// <para>Every figure here is either something somebody has to act on or the context needed
/// to judge it, and every one carries the link to the screen where you act. A dashboard of
/// numbers with nowhere to go is wallpaper — people look at it twice and then stop.</para>
///
/// <para>The shape depends on who is asking. A supervisor has no business seeing what the
/// site costs, so the money simply is not in his response — not hidden in the browser, where
/// it would still be one developer tools tab away.</para>
/// </summary>
public record SiteOverviewDto(
    Guid Id, string Code, string Name, string? ProjectName, string? City, bool IsActive,
    IReadOnlyList<SiteAlert> Alerts,
    SiteMoney? Money,
    int MaterialsHeld, int LowStockCount, DateTimeOffset? LastMovementAt,
    IReadOnlyList<SiteStockLine> RunningLow,
    IReadOnlyList<SiteDelivery> RecentDeliveries,
    IReadOnlyList<SitePerson> People,
    int OpenRequisitions, int OpenOrders, int DeliveriesThisMonth);

public sealed class SiteOverviewService(
    SiteStockDbContext db, StockLedger ledger, BudgetReader budgets, ICurrentUser me, TimeProvider clock)
{
    public async Task<SiteOverviewDto> BuildAsync(Guid siteId, CancellationToken ct)
    {
        var site = await db.Sites.AsNoTracking().FirstOrDefaultAsync(s => s.Id == siteId, ct)
                   ?? throw AppException.NotFound("That site");

        // A supervisor can reach his own sites and no others, whatever URL he types.
        if (!me.CanSeeSite(siteId)) throw AppException.Forbidden("You do not work at that site.");

        var now = clock.GetUtcNow();
        var monthStart = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var alerts = new List<SiteAlert>();

        // ── what is waiting on somebody ──────────────────────────────────────
        if (me.Can(Permissions.RequisitionsRead))
        {
            var waiting = await db.Requisitions.AsNoTracking()
                .Where(r => r.SiteId == siteId
                         && (r.Status == RequisitionStatus.Submitted || r.Status == RequisitionStatus.Priced))
                .Select(r => new { r.Status, r.CreatedAt })
                .ToListAsync(ct);

            AddRequisitionAlert(alerts, waiting.Where(r => r.Status == RequisitionStatus.Submitted).ToList(),
                now, siteId, "needs pricing", "Submitted", "requisitions-pricing");

            AddRequisitionAlert(alerts, waiting.Where(r => r.Status == RequisitionStatus.Priced).ToList(),
                now, siteId, "waiting for approval", "Priced", "requisitions-approval");
        }

        if (me.Can(Permissions.PurchaseOrdersRead))
        {
            var open = await db.PurchaseOrders.AsNoTracking()
                .Where(p => p.SiteId == siteId
                         && (p.Status == PurchaseOrderStatus.Issued
                          || p.Status == PurchaseOrderStatus.Sent
                          || p.Status == PurchaseOrderStatus.PartiallyReceived))
                .CountAsync(ct);

            var unsent = await db.PurchaseOrders.AsNoTracking()
                .CountAsync(p => p.SiteId == siteId && p.Status == PurchaseOrderStatus.Issued, ct);

            if (unsent > 0)
            {
                alerts.Add(new SiteAlert("orders-unsent",
                    $"{unsent} order{S(unsent)} not sent to the supplier",
                    "Approved and generated, but nobody has told the supplier yet.",
                    "/purchase-orders", "pending", unsent, "Buying"));
            }
        }

        if (me.Can(Permissions.InvoicesMatch))
        {
            var variances = await db.Invoices.AsNoTracking()
                .CountAsync(i => i.SiteId == siteId && i.Status == InvoiceStatus.Variance, ct);

            if (variances > 0)
            {
                alerts.Add(new SiteAlert("bills-variance",
                    $"{variances} bill{S(variances)} held back",
                    "The order, the delivery and the bill do not agree. Nothing is paid until they do.",
                    "/bills", "rejected", variances, "Money"));
            }
        }

        if (me.Can(Permissions.StockRead))
        {
            var answering = await db.TransferRequests.AsNoTracking()
                .CountAsync(t => t.FromSiteId == siteId && t.Status == TransferStatus.Requested, ct);

            if (answering > 0)
            {
                alerts.Add(new SiteAlert("transfers-answer",
                    $"{answering} site{S(answering)} asking you for material",
                    "Another site would rather borrow from you than buy it. They cannot order until you answer.",
                    "/transfers", "pending", answering, "Stock"));
            }
        }

        // ── stock ────────────────────────────────────────────────────────────
        var stock = me.Can(Permissions.StockRead)
            ? await ledger.ListAsync(siteId, onlyLowStock: false, ct)
            : [];

        var low = stock.Where(s => s.BelowReorderLevel).ToList();

        if (low.Count > 0)
        {
            alerts.Add(new SiteAlert("stock-low",
                $"{low.Count} material{S(low.Count)} at or below the warn-me level",
                string.Join(", ", low.Take(3).Select(s => s.MaterialName))
                    + (low.Count > 3 ? $" and {low.Count - 3} more" : string.Empty),
                "/stock", "pending", low.Count, "Stock"));
        }

        // ── money, and only for those who are allowed it ─────────────────────
        //
        // Read through BudgetReader rather than summing orders here. It already bounds the
        // total to the financial year and owns the 80%/100% thresholds; a second copy of
        // that arithmetic would quietly disagree with the approval screen the first time
        // either changed, and the screen that says "you have room" must never be the one
        // that turns out to be wrong.
        SiteMoney? money = null;
        if (me.Can(Permissions.BudgetsRead))
        {
            var snapshot = await budgets.SnapshotAsync(siteId, 0m, ct);

            if (snapshot.HasBudget)
            {
                money = new SiteMoney(snapshot.FinancialYear, snapshot.Allocated,
                    snapshot.CommittedToDate, snapshot.RemainingAfter, snapshot.PercentUsedAfter);

                if (snapshot.PercentUsedAfter >= BudgetReader.WarningPercent)
                {
                    alerts.Add(new SiteAlert("budget",
                        $"{snapshot.PercentUsedAfter:0.#}% of this year's budget is committed",
                        $"₹{snapshot.RemainingAfter:N0} left of ₹{snapshot.Allocated:N0} for {snapshot.FinancialYear}.",
                        // Straight to the screen where the allocation is actually set.
                        "/budgets", snapshot.PercentUsedAfter >= 100 ? "rejected" : "pending", 1,
                        "Money"));
                }
            }
        }

        // ── recent deliveries: the heartbeat of a site ───────────────────────
        var deliveries = me.Can(Permissions.StockRead)
            ? await db.GoodsReceipts.AsNoTracking()
                .Where(g => g.SiteId == siteId)
                .OrderByDescending(g => g.ReceivedAt)
                .Take(5)
                .Select(g => new SiteDelivery(
                    g.Id, g.Number, g.PurchaseOrder.Supplier.Name, g.ReceivedAt,
                    g.Lines.Count,
                    g.Lines.Any(l => l.AcceptedQuantity < l.OrderedQuantity)))
                .ToListAsync(ct)
            : [];

        var thisMonth = me.Can(Permissions.StockRead)
            ? await db.GoodsReceipts.AsNoTracking()
                .CountAsync(g => g.SiteId == siteId && g.ReceivedAt >= monthStart, ct)
            : 0;

        // ── who works here ───────────────────────────────────────────────────
        var people = me.Can(Permissions.UsersRead)
            ? await db.UserSiteRoles.AsNoTracking()
                .Where(a => a.SiteId == siteId && a.User.IsActive)
                .OrderBy(a => a.User.FullName)
                .Select(a => new SitePerson(a.UserId, a.User.FullName, a.Role.Name))
                .ToListAsync(ct)
            : [];

        var openRequisitions = me.Can(Permissions.RequisitionsRead)
            ? await db.Requisitions.AsNoTracking().CountAsync(r => r.SiteId == siteId
                && (r.Status == RequisitionStatus.Submitted || r.Status == RequisitionStatus.Priced), ct)
            : 0;

        var openOrders = me.Can(Permissions.PurchaseOrdersRead)
            ? await db.PurchaseOrders.AsNoTracking().CountAsync(p => p.SiteId == siteId
                && (p.Status == PurchaseOrderStatus.Issued
                 || p.Status == PurchaseOrderStatus.Sent
                 || p.Status == PurchaseOrderStatus.PartiallyReceived), ct)
            : 0;

        return new SiteOverviewDto(
            site.Id, site.Code, site.Name, site.ProjectName, site.City, site.IsActive,
            alerts.OrderBy(a => a.Tone == "rejected" ? 0 : 1).ToList(),
            money,
            stock.Count(s => s.Quantity > 0),
            low.Count,
            stock.Where(s => s.LastMovementAt is not null).Max(s => s.LastMovementAt),
            low.Take(6).Select(s => new SiteStockLine(
                s.MaterialName, s.UnitCode, s.Quantity, s.ReorderLevel, s.DaysOfCover)).ToList(),
            deliveries,
            people,
            openRequisitions, openOrders, thisMonth);
    }

    private static void AddRequisitionAlert(
        List<SiteAlert> alerts, IReadOnlyCollection<dynamic> rows, DateTimeOffset now, Guid siteId,
        string what, string status, string kind)
    {
        if (rows.Count == 0) return;

        var oldest = rows.Min(r => (DateTimeOffset)r.CreatedAt);
        var days = (int)(now - oldest).TotalDays;

        alerts.Add(new SiteAlert(kind,
            $"{rows.Count} request{S(rows.Count)} {what}",
            days >= 1 ? $"The oldest has been waiting {days} day{S(days)}." : "All raised today.",
            // The count is for this site, so the link has to be too — landing on every site's
            // requests after being told "5 here" is the sort of thing that costs a screen its
            // credibility the first time somebody counts the rows.
            $"/requisitions?status={status}&site={siteId}",
            days >= 2 ? "rejected" : "pending",
            rows.Count,
            // Pricing sits with the buyer, approval with the owner — the same split the
            // requisition list makes with its colours.
            status == "Priced" ? "Approving" : "Buying"));
    }

    private static string S(int count) => count == 1 ? string.Empty : "s";
}
