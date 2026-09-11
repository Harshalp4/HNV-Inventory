using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Billing;
using SiteStock.Api.Domain.Contracts;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Reports;

/// <param name="Key">Stable id so the client can pick an icon and a route without parsing text.</param>
/// <param name="Tone">ok, watch or bad — what the number means, decided here rather than in the browser.</param>
/// <param name="Trend">
/// Change against the comparable previous period, as a percentage. Null when there is
/// nothing honest to compare against — a first month, or a figure that is a count of things
/// standing rather than a flow over time.
/// </param>
/// <param name="TrendIsGood">
/// Whether a rise is good news. Spending more is not the same kind of "up" as receiving
/// more, and an arrow coloured by direction alone tells the wrong story half the time.
/// </param>
/// <param name="Spark">Recent months, oldest first, for a shape behind the number.</param>
public record DashboardCard(
    string Key, string Label, string Value, string? Hint,
    string Tone, string? Route,
    double? Trend = null, bool TrendIsGood = false,
    IReadOnlyList<decimal>? Spark = null);

/// <param name="Urgent">Shown first and coloured. Something is late or wrong.</param>
/// <param name="Group">
/// Which kind of work this is — Buying, Approving, Receiving, Money, Stock. Decided here
/// rather than by the screen matching on keys, so the grouping cannot drift from the counts.
/// </param>
/// <param name="Tone">
/// The colour language the lists already use: pending for the buyer's work, info for the
/// owner's, bad for money going wrong.
/// </param>
/// <param name="WaitingOn">
/// Who it sits with, when it is not this person. Set, the row is shown as something to keep
/// an eye on rather than something to do — a buyer whose order is held for release can see
/// that it is held, and by whom, without being offered a button he is not allowed to press.
/// </param>
public record DashboardTask(
    string Key, string Label, string Detail, int Count, string Route, bool Urgent,
    string Group = "Buying", string Tone = "pending", string? WaitingOn = null);

/// <param name="Cards">Headline numbers for whoever is looking.</param>
/// <param name="Tasks">Things waiting on this person, most pressing first.</param>
/// <param name="Sites">One row per site, so a total can be broken into places to go and look.</param>
public record Dashboard(
    string Greeting, string RoleSummary,
    IReadOnlyList<DashboardCard> Cards,
    IReadOnlyList<DashboardTask> Tasks,
    IReadOnlyList<SiteBoardRow> Sites,
    /// <summary>
    /// One row per live contract, with every order raised against it added up.
    /// </summary>
    /// <remarks>
    /// A contract is filled by many purchase orders over months, and until they are added
    /// together nobody can see that a job has quietly eaten its own margin. The work order
    /// screen answers it for one job; this answers it for all of them at once, which is the
    /// question an owner actually opens the app with.
    /// </remarks>
    IReadOnlyList<JobRow> Jobs,
    /// <summary>
    /// Where everything currently is along the six steps.
    /// </summary>
    /// <remarks>
    /// The dashboard could say what was waiting on <i>you</i> and what each contract had
    /// eaten, but never where the work as a whole had got to — and "where has this got to"
    /// is the question the whole product exists to answer. Six numbers, in the order the
    /// guide teaches them, each one a link into the list behind it.
    /// </remarks>
    IReadOnlyList<PipelineStage> Pipeline);

/// <param name="Key">Stable id, so the screen can route without matching on the label.</param>
/// <param name="Count">How many things are sitting at this step right now.</param>
/// <param name="Value">What they are worth, where the step knows. Null before pricing.</param>
public record PipelineStage(
    string Key, string Label, string Detail, int Count, decimal? Value, string Route, string Tone);

/// <param name="OrderCount">Purchase orders raised against this contract, cancelled ones aside.</param>
/// <param name="Received">Of what was committed, how much has actually turned up.</param>
/// <param name="Tone">ok · watch (80% or more committed) · bad (past the contract value).</param>
public record JobRow(
    Guid Id, string Number, string Title, string ClientName, string SiteName,
    decimal ContractValue, decimal Committed, decimal Received, decimal Remaining,
    int OrderCount, double PercentCommitted, double PercentDelivered, string Tone);

/// <summary>
/// The one screen that answers "what needs me today".
///
/// <para>Built per person from their permissions rather than per role name, so it stays
/// right when a role's permissions are edited — which they can be, from Roles. A supervisor
/// sees their gate and their store; a purchase head sees the queue and the suppliers going
/// wrong; an owner sees money and the jobs eating it.</para>
///
/// <para>Everything is counted the same way the screens count it. A number here that
/// disagreed with the list it links to would be worse than no number at all.</para>
/// </summary>
public sealed class DashboardService(
    SiteStockDbContext db, ICurrentUser me, TimeProvider clock, SiteBoardService board,
    Settings.SettingsService settings)
{
    /// <param name="siteId">
    /// One site, for the site's own screen. Null builds it across everything this person can
    /// see — the same figures, narrowed, rather than a second way of counting them.
    /// </param>
    public async Task<Dashboard> BuildAsync(Guid? siteId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var today = DateOnly.FromDateTime(now.UtcDateTime);

        if (siteId is { } only && !me.CanSeeSite(only))
            throw Common.Http.AppException.Forbidden("You do not have access to that site.");

        var sites = siteId is { } one
            ? [one]
            : me.HasAllSites ? null : me.SiteIds.ToList();

        var cards = new List<DashboardCard>();
        var tasks = new List<DashboardTask>();

        // ── things waiting on this person ────────────────────────────────────

        if (me.Can(Permissions.RequisitionsPrice))
        {
            var toPrice = await Scoped(db.Requisitions.AsNoTracking(), sites, r => r.SiteId)
                .CountAsync(r => r.Status == RequisitionStatus.Submitted, ct);

            if (toPrice > 0)
                tasks.Add(new("price", "Requests to price", Plural(toPrice, "request"), toPrice,
                    "/requisitions", false, "Buying", "pending"));
        }

        if (me.Can(Permissions.PurchasesApprove))
        {
            var toApprove = await Scoped(db.Requisitions.AsNoTracking(), sites, r => r.SiteId)
                .Where(r => r.Status == RequisitionStatus.Priced)
                .Select(r => new { r.Id, Value = r.Lines.Sum(l => l.Quantity * (l.UnitRate ?? 0m)) })
                .ToListAsync(ct);

            if (toApprove.Count > 0)
            {
                tasks.Add(new("approve", "Waiting for your approval",
                    $"{Plural(toApprove.Count, "request")} · {Money(toApprove.Sum(r => r.Value))}",
                    toApprove.Count, "/requisitions", false, "Approving", "info"));
            }
        }

        // ── waiting to be let out of the door ────────────────────────────────
        // An order can be approved as spending and still be held back until somebody named
        // in Settings signs off the paper going to the supplier. That second gate had no
        // task anywhere, so the person holding it was never told — the order simply sat.
        if (await IsSendApproverAsync(ct))
        {
            var toApprove = await Scoped(db.PurchaseOrders.AsNoTracking(), sites, o => o.SiteId)
                .CountAsync(o => o.CancelledAt == null
                                 && o.SendApproval == Domain.Procurement.SendApproval.Pending, ct);

            if (toApprove > 0)
            {
                tasks.Add(new("send-approval", "Orders waiting for you to release them",
                    $"{Plural(toApprove, "order")} approved to buy, held until you say they may go",
                    toApprove, "/purchase-orders", true, "Approving", "info"));
            }
        }

        if (me.Can(Permissions.PurchaseOrdersSend))
        {
            // Raised, approved to buy, and stuck behind somebody else's signature. Not the
            // buyer's to act on — but his to chase, and invisible until now.
            var held = await Scoped(db.PurchaseOrders.AsNoTracking(), sites, o => o.SiteId)
                .CountAsync(o => o.CancelledAt == null
                                 && o.SendApproval == Domain.Procurement.SendApproval.Pending, ct);

            if (held > 0 && !await IsSendApproverAsync(ct))
            {
                var with = await SendApproverNamesAsync(ct);
                tasks.Add(new("held", "Orders held for release",
                    $"{Plural(held, "order")} approved to buy, waiting to be let go",
                    held, "/purchase-orders", false, "Approving", "draft", with));
            }

            // Only the ones the buyer can actually act on. An order still behind the
            // release gate is not his to chase, and counting it here sent him to a screen
            // where every button was disabled.
            var toSend = await Scoped(db.PurchaseOrders.AsNoTracking(), sites, o => o.SiteId)
                .CountAsync(o => o.Status == PurchaseOrderStatus.Issued
                                 && o.SendApproval != Domain.Procurement.SendApproval.Pending, ct);

            if (toSend > 0)
                tasks.Add(new("send", "Orders not sent to the supplier", Plural(toSend, "order"), toSend,
                    "/purchase-orders", true, "Buying", "pending"));
        }

        if (me.Can(Permissions.GoodsReceive))
        {
            var arriving = await Scoped(db.PurchaseOrders.AsNoTracking(), sites, o => o.SiteId)
                .CountAsync(o => o.ExpectedDelivery <= today
                                 && (o.Status == PurchaseOrderStatus.Sent
                                     || o.Status == PurchaseOrderStatus.PartiallyReceived), ct);

            if (arriving > 0)
                tasks.Add(new("receive", "Deliveries due", $"{Plural(arriving, "order")} expected by today", arriving,
                    "/purchase-orders", false, "Receiving", "info"));

            var counting = await Scoped(db.GoodsReceipts.AsNoTracking(), sites, g => g.SiteId)
                .CountAsync(g => g.Status == GoodsReceiptStatus.Draft, ct);

            if (counting > 0)
                tasks.Add(new("counting", "Deliveries part-counted", $"{Plural(counting, "delivery", "deliveries")} left open",
                    counting, "/deliveries", true, "Receiving", "info"));
        }

        if (me.Can(Permissions.InvoicesMatch))
        {
            var variances = await Scoped(db.Invoices.AsNoTracking(), sites, i => i.SiteId)
                .CountAsync(i => i.Variances.Any(v => v.ResolvedAt == null), ct);

            if (variances > 0)
                tasks.Add(new("variance", "Bills that do not agree", $"{Plural(variances, "invoice")} with a difference",
                    variances, "/invoices", true, "Money", "bad"));
        }

        // ── the numbers ──────────────────────────────────────────────────────

        if (me.Can(Permissions.PricesRead))
        {
            var monthStart = new DateTimeOffset(new DateTime(now.Year, now.Month, 1), TimeSpan.Zero);
            var lastMonthStart = monthStart.AddMonths(-1);

            var orders = Scoped(db.PurchaseOrders.AsNoTracking(), sites, o => o.SiteId)
                .Where(o => o.Status != PurchaseOrderStatus.Cancelled);

            var thisMonth = await orders
                .Where(o => o.IssuedAt >= monthStart)
                .SumAsync(o => (decimal?)o.GrandTotal, ct) ?? 0m;

            var lastMonth = await orders
                .Where(o => o.IssuedAt >= lastMonthStart && o.IssuedAt < monthStart)
                .SumAsync(o => (decimal?)o.GrandTotal, ct) ?? 0m;

            // Six months of shape behind the figure. A number on its own says nothing about
            // whether this month is normal.
            var sixMonths = await orders
                .Where(o => o.IssuedAt >= monthStart.AddMonths(-5))
                .Select(o => new { o.IssuedAt, o.GrandTotal })
                .ToListAsync(ct);

            var spark = Enumerable.Range(0, 6)
                .Select(back => monthStart.AddMonths(back - 5))
                .Select(month => sixMonths
                    .Where(o => o.IssuedAt >= month && o.IssuedAt < month.AddMonths(1))
                    .Sum(o => o.GrandTotal))
                .ToList();

            cards.Add(new("committed", "Committed this month", Money(thisMonth),
                lastMonth == 0 ? "Nothing ordered last month" : $"vs {Money(lastMonth)} last month",
                thisMonth > lastMonth && lastMonth > 0 ? "watch" : "ok", "/reports",
                lastMonth == 0 ? null : (double)Math.Round((thisMonth - lastMonth) / lastMonth * 100m, 0),
                TrendIsGood: false,
                Spark: Shape(spark)));

            var owed = await db.Invoices.AsNoTracking()
                .Where(i => i.PaidAt == null && i.Status != InvoiceStatus.Disputed && i.Status != InvoiceStatus.Paid)
                .Where(i => sites == null || sites.Contains(i.SiteId))
                .Select(i => new { i.DueDate, i.PayableAmount })
                .ToListAsync(ct);

            var overdue = owed.Where(i => i.DueDate < today).ToList();

            cards.Add(new("owed", "Owed to suppliers", Money(owed.Sum(i => i.PayableAmount)),
                overdue.Count == 0
                    ? "Nothing overdue"
                    : $"{Money(overdue.Sum(i => i.PayableAmount))} past its due date",
                overdue.Count > 0 ? "bad" : "ok", "/reports"));
        }

        if (me.Can(Permissions.BudgetsRead))
        {
            var jobs = await db.WorkOrders.AsNoTracking()
                .Where(w => w.Status == WorkOrderStatus.Active)
                .Where(w => sites == null || sites.Contains(w.SiteId))
                .Select(w => new
                {
                    w.Id,
                    w.ContractValue,
                    Committed = db.PurchaseOrders
                        .Where(o => o.WorkOrderId == w.Id && o.Status != PurchaseOrderStatus.Cancelled)
                        .Sum(o => (decimal?)o.GrandTotal) ?? 0m,
                })
                .ToListAsync(ct);

            // A job with no contract value cannot be measured against one. Saying "all within
            // budget" about it would be a lie of omission, so it is counted separately and
            // named — somebody has to go and put the figure in.
            var priced = jobs.Where(j => j.ContractValue > 0).ToList();
            var unpriced = jobs.Count - priced.Count;
            var tight = priced.Count(j => j.Committed >= j.ContractValue * 0.8m);

            var hint = priced.Count == 0
                ? $"{Plural(jobs.Count, "live job")} · no contract value recorded on any of them"
                : unpriced > 0
                    ? $"of {priced.Count} costed · {unpriced} with no contract value"
                    : tight == 0
                        ? $"{Plural(jobs.Count, "live job")}, all within budget"
                        : $"of {jobs.Count} live · past 80% of the contract";

            cards.Add(new("jobs", "Jobs near their budget",
                priced.Count == 0 ? "—" : tight.ToString(),
                hint,
                tight > 0 ? "watch" : priced.Count == 0 ? "watch" : "ok", "/reports"));
        }

        if (me.Can(Permissions.StockRead))
        {
            var monthStart = new DateTimeOffset(new DateTime(now.Year, now.Month, 1), TimeSpan.Zero);

            // Six months in one read, then counted per month in memory. A write-off count on
            // its own says nothing — two this month is calm after nine, and alarming after none.
            var writeOffDates = await db.StockMovements.AsNoTracking()
                .Where(m => m.OccurredAt >= monthStart.AddMonths(-5))
                .Where(m => m.Reason != null
                            && m.Reason != AdjustmentReason.FoundExtra
                            && m.Reason != AdjustmentReason.EntryError
                            && m.Reason != AdjustmentReason.Miscount)
                .Where(m => m.Type == MovementType.WrittenOff
                            || (m.Type == MovementType.Adjustment && m.Quantity < 0))
                .Where(m => sites == null || sites.Contains(m.SiteId))
                .Select(m => m.OccurredAt)
                .ToListAsync(ct);

            var lossMonths = Enumerable.Range(0, 6)
                .Select(back => monthStart.AddMonths(back - 5))
                .Select(month => (decimal)writeOffDates.Count(d => d >= month && d < month.AddMonths(1)))
                .ToList();

            var written = (int)lossMonths[^1];
            var lastLosses = lossMonths[^2];

            cards.Add(new("losses", "Write-offs this month", written.ToString(),
                written == 0 ? "Nothing lost, damaged or written off" : "Damaged, lost, stolen or wasted",
                written > 0 ? "watch" : "ok", "/reports",
                lastLosses == 0 ? null : (double)Math.Round((written - lastLosses) / lastLosses * 100m, 0),
                TrendIsGood: false,
                Spark: Shape(lossMonths)));

            // Returnable tools handed out and not brought back. Nobody chases these unless
            // something counts them.
            var out_ = await db.StockIssues.AsNoTracking()
                .Where(i => sites == null || sites.Contains(i.SiteId))
                .SelectMany(i => i.Lines)
                .Where(l => l.IsReturnable && l.QuantityReturned < l.Quantity)
                .CountAsync(ct);

            if (out_ > 0)
                tasks.Add(new("returns", "Tools still with labour", $"{Plural(out_, "item")} not returned", out_,
                    "/handovers", false, "Stock", "draft"));
        }

        return new Dashboard(
            Greeting(now, me.FullName),
            RoleSummary(),
            cards,
            tasks.OrderByDescending(t => t.Urgent).ThenByDescending(t => t.Count).ToList(),
            siteId is null ? await board.BuildAsync(ct) : [],
            await JobsAsync(sites, ct),
            await PipelineAsync(sites, ct));
    }

    /// <summary>
    /// How much work is sitting at each of the six steps, right now.
    /// </summary>
    /// <remarks>
    /// Counts of what is <i>at</i> a step, not what has ever passed through it. A number
    /// that only ever climbs is a vanity figure; a number that empties when the work is
    /// done tells somebody where the queue is. Money is shown only from pricing onward,
    /// because before that there is honestly no figure to show.
    /// </remarks>
    private async Task<IReadOnlyList<PipelineStage>> PipelineAsync(
        List<Guid>? sites, CancellationToken ct)
    {
        var asked = await Scoped(db.Requisitions.AsNoTracking(), sites, r => r.SiteId)
            .Where(r => r.Status == RequisitionStatus.Submitted)
            .CountAsync(ct);

        var priced = await Scoped(db.Requisitions.AsNoTracking(), sites, r => r.SiteId)
            .Where(r => r.Status == RequisitionStatus.Priced)
            .CountAsync(ct);

        // A requisition keeps no total of its own — it is the sum of its lines, and the
        // per-line total is computed in C# rather than stored, so this is added up here
        // rather than in SQL. The set is the approval queue, so it is small by definition.
        var pricedValue = (await Scoped(db.Requisitions.AsNoTracking(), sites, r => r.SiteId)
            .Where(r => r.Status == RequisitionStatus.Priced)
            .Select(r => r.Lines)
            .ToListAsync(ct))
            .SelectMany(lines => lines)
            .Sum(l => l.LineTotalWithTax);

        // An order that exists but has not reached the supplier is not yet "ordered": it is
        // sitting on somebody's desk, which is exactly the stall this is meant to expose.
        var toSend = await Scoped(db.PurchaseOrders.AsNoTracking(), sites, o => o.SiteId)
            .Where(o => o.Status == PurchaseOrderStatus.Issued)
            .ToListAsync(ct);

        var awaiting = await Scoped(db.PurchaseOrders.AsNoTracking(), sites, o => o.SiteId)
            .Where(o => o.Status == PurchaseOrderStatus.Sent
                     || o.Status == PurchaseOrderStatus.PartiallyReceived)
            .ToListAsync(ct);

        var billing = await Scoped(db.Invoices.AsNoTracking(), sites, i => i.SiteId)
            .Where(i => i.Status != InvoiceStatus.Paid)
            .ToListAsync(ct);

        return
        [
            new("asked", "Asked for", "requests waiting to be priced",
                asked, null, "/requisitions", "draft"),
            new("priced", "Priced", "waiting for approval",
                priced, pricedValue, "/requisitions", "info"),
            new("to-send", "Not sent yet", "approved, still on a desk",
                toSend.Count, toSend.Sum(o => o.GrandTotal), "/purchase-orders", "pending"),
            new("ordered", "With the supplier", "sent, not fully delivered",
                awaiting.Count, awaiting.Sum(o => o.GrandTotal), "/purchase-orders", "info"),
            new("delivered", "Delivered", "arrived and counted in",
                await DeliveredCountAsync(sites, ct), null, "/deliveries", "approved"),
            new("billing", "To settle", "bills not yet paid",
                billing.Count, billing.Sum(i => i.GrandTotal), "/bills", "variance"),
        ];
    }

    private async Task<int> DeliveredCountAsync(List<Guid>? sites, CancellationToken ct) =>
        await Scoped(db.GoodsReceipts.AsNoTracking(), sites, g => g.SiteId)
            .Where(g => g.Status == GoodsReceiptStatus.Accepted)
            .CountAsync(ct);

    /// <summary>
    /// Every open contract, with what has been ordered and received against it.
    /// </summary>
    /// <remarks>
    /// Three grouped queries rather than one per contract: twenty jobs must not mean sixty
    /// round trips. Cancelled orders are left out of both figures — a withdrawn order never
    /// cost the job anything, and counting it would make a healthy job look spent.
    /// </remarks>
    private async Task<IReadOnlyList<JobRow>> JobsAsync(
        List<Guid>? sites, CancellationToken ct)
    {
        if (!me.Can(Permissions.WorkOrdersRead) || !me.Can(Permissions.PricesRead)) return [];

        var jobs = await db.WorkOrders.AsNoTracking()
            .Include(w => w.Site)
            .Where(w => w.Status == WorkOrderStatus.Active || w.Status == WorkOrderStatus.OnHold)
            .Where(w => sites == null || sites.Contains(w.SiteId))
            .ToListAsync(ct);

        if (jobs.Count == 0) return [];

        var ids = jobs.Select(w => w.Id).ToList();

        var committed = await db.PurchaseOrders.AsNoTracking()
            .Where(o => o.WorkOrderId != null && ids.Contains(o.WorkOrderId!.Value)
                        && o.Status != PurchaseOrderStatus.Cancelled)
            .GroupBy(o => o.WorkOrderId!.Value)
            .Select(g => new { Id = g.Key, Value = g.Sum(o => o.GrandTotal), Count = g.Count() })
            .ToDictionaryAsync(x => x.Id, x => x, ct);

        var received = await db.GoodsReceiptLines.AsNoTracking()
            .Where(l => l.GoodsReceipt.Status == GoodsReceiptStatus.Accepted
                        && l.PurchaseOrderLine.PurchaseOrder.WorkOrderId != null
                        && ids.Contains(l.PurchaseOrderLine.PurchaseOrder.WorkOrderId!.Value))
            .GroupBy(l => l.PurchaseOrderLine.PurchaseOrder.WorkOrderId!.Value)
            .Select(g => new
            {
                Id = g.Key,
                Value = g.Sum(l => l.AcceptedQuantity * l.PurchaseOrderLine.UnitRate),
            })
            .ToDictionaryAsync(x => x.Id, x => x.Value, ct);

        return jobs
            .Select(job =>
            {
                committed.TryGetValue(job.Id, out var spend);
                received.TryGetValue(job.Id, out var got);

                var value = job.ContractValue;
                var used = spend?.Value ?? 0m;

                var percent = value > 0 ? (double)Math.Round(used / value * 100m, 1) : 0d;
                var delivered = used > 0 ? (double)Math.Round(got / used * 100m, 1) : 0d;

                return new JobRow(
                    job.Id, job.Number, job.Title, job.ClientName, job.Site.Name,
                    value, used, Math.Round(got, 2), value - used,
                    spend?.Count ?? 0, percent, delivered,
                    percent >= 100 ? "bad" : percent >= 80 ? "watch" : "ok");
            })
            .OrderByDescending(j => j.PercentCommitted)
            .ThenByDescending(j => j.Committed)
            .ToList();
    }

    /// <summary>Who the release gate sits with, in words.</summary>
    private async Task<string> SendApproverNamesAsync(CancellationToken ct)
    {
        var ids = await SendApproverIdsAsync(ct);

        if (ids.Count == 0) return "whoever approves spending";

        var names = await db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id) && u.IsActive)
            .Select(u => u.FullName)
            .ToListAsync(ct);

        return names.Count == 0 ? "nobody — set an approver in Settings" : string.Join(" or ", names);
    }

    private async Task<List<Guid>> SendApproverIdsAsync(CancellationToken ct)
    {
        var raw = await settings.GetAsync(Domain.Configuration.SettingKeys.SendApprovers, ct) ?? string.Empty;

        return raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(part => Guid.TryParse(part, out var id) ? id : (Guid?)null)
            .Where(id => id is not null)
            .Select(id => id!.Value)
            .ToList();
    }

    /// <summary>
    /// Whether this person is one of those named to release orders to suppliers.
    /// </summary>
    /// <remarks>
    /// The same rule the order screen enforces: the people named in Settings, or — when
    /// nobody has been named — whoever approves spending, so the gate never has no
    /// gatekeeper.
    /// </remarks>
    private async Task<bool> IsSendApproverAsync(CancellationToken ct)
    {
        var ids = await SendApproverIdsAsync(ct);
        return ids.Count == 0 ? me.Can(Permissions.PurchasesApprove) : ids.Contains(me.Id);
    }

    /// <summary>
    /// A six-month series, or nothing at all when there is no shape in it yet.
    /// </summary>
    /// <remarks>
    /// Five flat months and one bar is not a trend, and a row of six zeros drawn as a chart
    /// is worse than no chart — it looks like data. A shape needs at least two months that
    /// actually happened before it is worth the ink.
    /// </remarks>
    private static IReadOnlyList<decimal>? Shape(IReadOnlyList<decimal> months) =>
        months.Count(m => m > 0) >= 2 ? months : null;

    private string RoleSummary()
    {
        var parts = new List<string>();
        if (me.Can(Permissions.PurchasesApprove)) parts.Add("approving spend");
        else if (me.Can(Permissions.RequisitionsPrice)) parts.Add("pricing and ordering");
        else if (me.Can(Permissions.GoodsReceive)) parts.Add("the site store");

        var where = me.HasAllSites ? "across all sites" : $"at {Plural(me.SiteIds.Count(), "site")}";
        return parts.Count == 0 ? where : $"{Capitalise(parts[0])} · {where}";
    }

    private static IQueryable<T> Scoped<T>(
        IQueryable<T> query, List<Guid>? sites, System.Linq.Expressions.Expression<Func<T, Guid>> siteId)
    {
        if (sites is null) return query;

        // Built by hand rather than with a closure so EF translates it: Contains over a local
        // list is fine, a captured lambda applied to a property is not.
        var parameter = siteId.Parameters[0];
        var contains = System.Linq.Expressions.Expression.Call(
            typeof(Enumerable), nameof(Enumerable.Contains), [typeof(Guid)],
            System.Linq.Expressions.Expression.Constant(sites), siteId.Body);

        return query.Where(
            System.Linq.Expressions.Expression.Lambda<Func<T, bool>>(contains, parameter));
    }

    private static string Greeting(DateTimeOffset now, string name)
    {
        // Indian Standard Time: the server may be anywhere, the site never is.
        var local = now.ToOffset(TimeSpan.FromMinutes(330)).Hour;
        var part = local < 12 ? "Good morning" : local < 17 ? "Good afternoon" : "Good evening";
        return $"{part}, {name.Split(' ')[0]}";
    }

    private static string Money(decimal value) =>
        value >= 100000m ? $"₹{value / 100000m:0.##} lakh" : $"₹{value:N0}";

    private static string Plural(int count, string one, string? many = null) =>
        count == 1 ? $"{count} {one}" : $"{count} {many ?? one + "s"}";

    private static string Capitalise(string value) =>
        value.Length == 0 ? value : char.ToUpperInvariant(value[0]) + value[1..];
}
