using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Billing;
using SiteStock.Api.Domain.Contracts;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Reports;

/// <param name="Committed">Everything ordered and not cancelled, at order prices.</param>
/// <param name="Received">The part of that which has actually been accepted into stock.</param>
/// <param name="Margin">Contract value less committed — what is left on the job.</param>
/// <summary>One purchase order's share of a job's spend.</summary>
/// <param name="Received">Valued at the rate on the order line — what the goods actually cost.</param>
public record JobOrderRow(
    Guid OrderId, string Number, string SupplierName, string Status,
    DateTimeOffset IssuedAt, decimal Value, decimal Received);

public record JobCostRow(
    Guid WorkOrderId, string Number, string Title, string ClientName, string SiteName,
    string Status, DateOnly? StartDate, DateOnly? EndDate,
    decimal ContractValue, decimal Committed, decimal Received,
    decimal Margin, double MarginPercent, double PercentCommitted,
    int OrderCount,
    /// <summary>
    /// The orders making up that spend, newest first. A job's total says how much has gone;
    /// only the orders say where it went, and a total nobody can break apart is a total
    /// nobody acts on.
    /// </summary>
    IReadOnlyList<JobOrderRow> Orders);

/// <param name="Value">Counted at the last rate paid for that material.</param>
public record LossRow(
    string Reason, string SiteName, Guid SiteId,
    decimal Quantity, decimal Value, int Occurrences);

public record LossDetailRow(
    DateTimeOffset OccurredAt, string SiteName, string MaterialName, string UnitCode,
    string Reason, decimal Quantity, decimal Value, string RecordedByName, string? Notes);

/// <param name="Bucket">Not due, 1-30, 31-60, 61-90 or Over 90 days late.</param>
public record PayableRow(
    string Bucket, int InvoiceCount, decimal Amount);

public record PayableDetailRow(
    Guid InvoiceId, string SupplierInvoiceNumber, string SupplierName, string PurchaseOrderNumber,
    DateOnly InvoiceDate, DateOnly DueDate, int DaysLate, decimal PayableAmount,
    string Status, bool HasOpenVariance);

/// <param name="Rates">One point per month the material was bought in, oldest first.</param>
public record RateHistoryRow(
    Guid MaterialId, string MaterialCode, string MaterialName, string UnitCode,
    decimal FirstRate, decimal LastRate, decimal LowestRate, decimal HighestRate,
    double ChangePercent, int OrderCount,
    IReadOnlyList<RatePoint> Rates);

public record RatePoint(string Month, decimal AverageRate, string CheapestSupplier, decimal CheapestRate);

/// <param name="DaysSinceMoved">
/// Days since anything left the store for this material at this site — or, when nothing ever
/// has, days since it arrived. Both answer the same question: how long has it been sitting.
/// </param>
/// <param name="LastMovedAt">Null when nothing has ever been taken out of it.</param>
/// <param name="Value">Zero when the material has never been bought, so there is no rate to value it at.</param>
public record DeadStockRow(
    Guid SiteId, string SiteName, Guid MaterialId, string MaterialName, string UnitCode,
    decimal OnHand, decimal Value, int DaysSinceMoved, DateTimeOffset? LastMovedAt);

/// <param name="Stage">Where the days were spent.</param>
public record CycleTimeRow(string Stage, double AverageDays, double SlowestDays, int Samples);

/// <param name="AverageLeadDays">Order issued to material accepted, for this material.</param>
public record LeadTimeRow(
    Guid MaterialId, string MaterialName, string UnitCode,
    double AverageLeadDays, double SlowestLeadDays, int Deliveries, string SlowestSupplier);

/// <summary>
/// The reports that answer money and loss questions rather than workflow ones.
///
/// <para>Split from <see cref="ReportService"/> because these read across contracts, the
/// stock ledger and the invoice book, and a single class holding all of it stops being
/// something anybody can follow.</para>
///
/// <para>Everything is derived from records the workflow already writes. Nothing here has a
/// write path of its own, so a figure on a report cannot drift from the screen it came
/// from — the reason the stock ledger has no running-total column in the first place.</para>
/// </summary>
public sealed class CostingReportService(SiteStockDbContext db, ICurrentUser me, TimeProvider clock)
{
    private List<Guid>? PermittedSites() => me.HasAllSites ? null : me.SiteIds.ToList();

    // ── job costing ──────────────────────────────────────────────────────────

    /// <summary>
    /// Every contract with what it is worth beside what it has cost so far.
    ///
    /// <para>Committed counts orders at the price they were placed at, including material
    /// that has not arrived — money is committed the moment the owner approves, not when the
    /// lorry turns up. Received counts only what was accepted into stock, which is the part
    /// a supplier can actually invoice for.</para>
    /// </summary>
    public async Task<IReadOnlyList<JobCostRow>> JobCostsAsync(
        string? status, CancellationToken ct)
    {
        var sites = PermittedSites();

        var jobs = db.WorkOrders.AsNoTracking().Include(w => w.Site).AsQueryable();
        if (sites is not null) jobs = jobs.Where(w => sites.Contains(w.SiteId));

        if (!string.IsNullOrWhiteSpace(status)
            && Enum.TryParse<WorkOrderStatus>(status, true, out var wanted))
        {
            jobs = jobs.Where(w => w.Status == wanted);
        }

        var list = await jobs.ToListAsync(ct);
        if (list.Count == 0) return [];

        var ids = list.Select(w => w.Id).ToList();

        var committed = await db.PurchaseOrders.AsNoTracking()
            .Where(o => o.WorkOrderId != null && ids.Contains(o.WorkOrderId.Value)
                        && o.Status != PurchaseOrderStatus.Cancelled)
            .GroupBy(o => o.WorkOrderId!.Value)
            .Select(g => new { Job = g.Key, Value = g.Sum(o => o.GrandTotal), Count = g.Count() })
            .ToDictionaryAsync(x => x.Job, x => x, ct);

        // Accepted quantity at the rate on the order line — what the material actually cost.
        var received = await db.GoodsReceipts.AsNoTracking()
            .Where(g => g.Status == GoodsReceiptStatus.Accepted
                        && g.PurchaseOrder.WorkOrderId != null
                        && ids.Contains(g.PurchaseOrder.WorkOrderId!.Value))
            .SelectMany(g => g.Lines)
            .GroupBy(l => l.GoodsReceipt.PurchaseOrder.WorkOrderId!.Value)
            .Select(g => new { Job = g.Key, Value = g.Sum(l => l.AcceptedQuantity * l.PurchaseOrderLine.UnitRate) })
            .ToDictionaryAsync(x => x.Job, x => x.Value, ct);

        // What each order took, so a job's spend can be broken open where it is shown.
        var receivedByOrder = await db.GoodsReceiptLines.AsNoTracking()
            .Where(l => l.GoodsReceipt.Status == GoodsReceiptStatus.Accepted
                        && l.GoodsReceipt.PurchaseOrder.WorkOrderId != null
                        && ids.Contains(l.GoodsReceipt.PurchaseOrder.WorkOrderId!.Value))
            .GroupBy(l => l.GoodsReceipt.PurchaseOrderId)
            .Select(g => new
            {
                OrderId = g.Key,
                Value = g.Sum(l => l.AcceptedQuantity * l.PurchaseOrderLine.UnitRate),
            })
            .ToDictionaryAsync(x => x.OrderId, x => x.Value, ct);

        var orderRows = await db.PurchaseOrders.AsNoTracking()
            .Where(o => o.WorkOrderId != null && ids.Contains(o.WorkOrderId!.Value)
                        && o.Status != PurchaseOrderStatus.Cancelled)
            .Select(o => new
            {
                Job = o.WorkOrderId!.Value,
                o.Id, o.Number, Supplier = o.Supplier.Name, o.Status, o.IssuedAt, o.GrandTotal,
            })
            .ToListAsync(ct);

        var byJob = orderRows
            .GroupBy(x => x.Job)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<JobOrderRow>)g
                    .Select(o => new JobOrderRow(
                        o.Id, o.Number, o.Supplier, o.Status.ToString(), o.IssuedAt,
                        o.GrandTotal,
                        Math.Round(receivedByOrder.TryGetValue(o.Id, out var got) ? got : 0m, 2)))
                    .OrderByDescending(r => r.IssuedAt)
                    .ToList());

        return list
            .Select(w =>
            {
                committed.TryGetValue(w.Id, out var spend);
                received.TryGetValue(w.Id, out var got);
                byJob.TryGetValue(w.Id, out var orders);

                var value = w.ContractValue;
                var used = spend?.Value ?? 0m;
                var margin = value - used;

                return new JobCostRow(
                    w.Id, w.Number, w.Title, w.ClientName, w.Site.Name,
                    w.Status.ToString(), w.StartDate, w.EndDate,
                    value, used, Math.Round(got, 2), margin,
                    Percent(margin, value), Percent(used, value),
                    spend?.Count ?? 0, orders ?? []);
            })
            .OrderByDescending(r => r.PercentCommitted)
            .ToList();
    }

    // ── losses ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Stock that went out of the books without going into the work: damaged, lost, stolen,
    /// wasted, or counted short with no explanation.
    ///
    /// <para>Valued at the last rate paid for that material, because the ledger holds
    /// quantities and the money question is asked against what it would cost to replace.</para>
    /// </summary>
    public async Task<IReadOnlyList<LossRow>> LossesAsync(
        Guid? siteId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var movements = LossQuery(siteId, from, to);

        var flat = await movements
            .Select(m => new
            {
                Reason = m.Reason!.Value,
                m.SiteId,
                SiteName = m.Site.Name,
                m.MaterialId,
                m.Quantity,
            })
            .ToListAsync(ct);

        if (flat.Count == 0) return [];

        var rates = await LastRatesAsync(flat.Select(f => f.MaterialId).Distinct().ToList(), ct);

        return flat
            .GroupBy(f => new { f.Reason, f.SiteId, f.SiteName })
            .Select(g => new LossRow(
                Readable(g.Key.Reason.ToString()), g.Key.SiteName, g.Key.SiteId,
                Math.Round(g.Sum(x => Math.Abs(x.Quantity)), 3),
                Math.Round(g.Sum(x => Math.Abs(x.Quantity) * Rate(rates, x.MaterialId)), 2),
                g.Count()))
            .OrderByDescending(r => r.Value)
            .ToList();
    }

    /// <summary>Every write-off, one row each, for the month somebody wants to argue about.</summary>
    public async Task<IReadOnlyList<LossDetailRow>> LossDetailAsync(
        Guid? siteId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var flat = await LossQuery(siteId, from, to)
            .OrderByDescending(m => m.OccurredAt)
            .Take(500)
            .Select(m => new
            {
                m.OccurredAt,
                SiteName = m.Site.Name,
                MaterialName = m.Material.Name,
                UnitCode = m.Material.Unit.Code,
                Reason = m.Reason!.Value,
                m.Quantity,
                m.MaterialId,
                RecordedBy = m.RecordedBy.FullName,
                m.Notes,
            })
            .ToListAsync(ct);

        if (flat.Count == 0) return [];

        var rates = await LastRatesAsync(flat.Select(f => f.MaterialId).Distinct().ToList(), ct);

        return flat.Select(f => new LossDetailRow(
            f.OccurredAt, f.SiteName, f.MaterialName, f.UnitCode,
            Readable(f.Reason.ToString()), Math.Abs(f.Quantity),
            Math.Round(Math.Abs(f.Quantity) * Rate(rates, f.MaterialId), 2),
            f.RecordedBy, f.Notes)).ToList();
    }

    private IQueryable<StockMovement> LossQuery(Guid? siteId, DateOnly from, DateOnly to)
    {
        var sites = PermittedSites();

        if (siteId is { } id && !me.CanSeeSite(id))
            throw AppException.Forbidden("You do not have access to that site.");

        var start = from.ToDateTime(TimeOnly.MinValue).ToUniversalTime();
        var end = to.AddDays(1).ToDateTime(TimeOnly.MinValue).ToUniversalTime();

        // Adjustments that took stock away, and everything written off. FoundExtra and
        // EntryError are corrections rather than losses and would flatter or distort the
        // total in opposite directions.
        var losing = new[]
        {
            AdjustmentReason.Damaged, AdjustmentReason.Lost, AdjustmentReason.Stolen,
            AdjustmentReason.Wastage, AdjustmentReason.Expired, AdjustmentReason.Unexplained,
        };

        var query = db.StockMovements.AsNoTracking()
            .Where(m => m.OccurredAt >= start && m.OccurredAt < end)
            .Where(m => m.Reason != null && losing.Contains(m.Reason.Value))
            .Where(m => m.Type == MovementType.WrittenOff
                        || (m.Type == MovementType.Adjustment && m.Quantity < 0));

        if (siteId is { } only) query = query.Where(m => m.SiteId == only);
        if (sites is not null) query = query.Where(m => sites.Contains(m.SiteId));

        return query;
    }

    // ── what we owe ──────────────────────────────────────────────────────────

    /// <summary>
    /// Unpaid supplier invoices, bucketed by how late they are.
    ///
    /// <para>Anything already released for payment drops out — this is what is still owed,
    /// not a history of what was paid.</para>
    /// </summary>
    public async Task<IReadOnlyList<PayableRow>> PayablesAsync(CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

        // Payable less what has already gone out. Before payments were recorded this counted
        // the full bill for ever, so the figure only ever went up.
        var rows = await OpenInvoices()
            .Select(i => new
            {
                i.DueDate,
                Outstanding = i.PayableAmount - i.Payments.Sum(p => (decimal?)p.Amount) ?? i.PayableAmount,
            })
            .ToListAsync(ct);

        return rows
            .Where(i => i.Outstanding > 0)
            .GroupBy(i => Bucket(today.DayNumber - i.DueDate.DayNumber))
            .Select(g => new PayableRow(g.Key, g.Count(), Math.Round(g.Sum(x => x.Outstanding), 2)))
            .OrderBy(r => BucketOrder(r.Bucket))
            .ToList();
    }

    public async Task<IReadOnlyList<PayableDetailRow>> PayableDetailAsync(CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

        var rows = await OpenInvoices()
            .Select(i => new
            {
                i.Id, i.SupplierInvoiceNumber,
                SupplierName = i.Supplier.Name,
                OrderNumber = i.PurchaseOrder.Number,
                i.InvoiceDate, i.DueDate, i.PayableAmount,
                Paid = i.Payments.Sum(p => (decimal?)p.Amount) ?? 0m,
                i.Status,
                OpenVariance = i.Variances.Any(v => v.ResolvedAt == null),
            })
            .ToListAsync(ct);

        return rows
            .Where(i => i.PayableAmount - i.Paid > 0)
            .Select(i => new PayableDetailRow(
                i.Id, i.SupplierInvoiceNumber, i.SupplierName, i.OrderNumber,
                i.InvoiceDate, i.DueDate, today.DayNumber - i.DueDate.DayNumber,
                Math.Round(i.PayableAmount - i.Paid, 2), i.Status.ToString(), i.OpenVariance))
            .OrderByDescending(i => i.DaysLate)
            .ToList();
    }

    private IQueryable<Invoice> OpenInvoices()
    {
        var sites = PermittedSites();

        // Disputed bills are excluded: nothing will be paid on one until the supplier
        // re-issues it, so counting it as owed overstates what is actually going out.
        var query = db.Invoices.AsNoTracking()
            .Where(i => i.PaidAt == null
                        && i.Status != InvoiceStatus.Disputed
                        && i.Status != InvoiceStatus.Paid);

        if (sites is not null) query = query.Where(i => sites.Contains(i.SiteId));

        return query;
    }

    // ── what we are paying ───────────────────────────────────────────────────

    /// <summary>
    /// What a material has cost over time, and who sold it cheapest each month.
    ///
    /// <para>The point is not the average. It is the answer to "we paid ₹62 last quarter and
    /// ₹71 now" while there is still time to ring somebody about it.</para>
    /// </summary>
    public async Task<IReadOnlyList<RateHistoryRow>> RateHistoryAsync(
        Guid? materialId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var start = from.ToDateTime(TimeOnly.MinValue).ToUniversalTime();
        var end = to.AddDays(1).ToDateTime(TimeOnly.MinValue).ToUniversalTime();
        var sites = PermittedSites();

        var lines = db.PurchaseOrderLines.AsNoTracking()
            .Where(l => l.PurchaseOrder.Status != PurchaseOrderStatus.Cancelled)
            .Where(l => l.PurchaseOrder.IssuedAt >= start && l.PurchaseOrder.IssuedAt < end);

        if (materialId is { } only) lines = lines.Where(l => l.MaterialId == only);
        if (sites is not null) lines = lines.Where(l => sites.Contains(l.PurchaseOrder.SiteId));

        var flat = await lines
            .Select(l => new
            {
                l.MaterialId,
                Code = l.Material.Code,
                Name = l.Material.Name,
                Unit = l.Material.Unit.Code,
                Supplier = l.PurchaseOrder.Supplier.Name,
                l.UnitRate,
                At = l.PurchaseOrder.IssuedAt,
            })
            .ToListAsync(ct);

        return flat
            .GroupBy(l => new { l.MaterialId, l.Code, l.Name, l.Unit })
            .Select(g =>
            {
                var byMonth = g
                    .GroupBy(l => l.At.ToString("yyyy-MM"))
                    .OrderBy(m => m.Key)
                    .Select(m =>
                    {
                        var cheapest = m.OrderBy(l => l.UnitRate).First();
                        return new RatePoint(
                            m.Key, Math.Round(m.Average(l => l.UnitRate), 2),
                            cheapest.Supplier, cheapest.UnitRate);
                    })
                    .ToList();

                var first = byMonth[0].AverageRate;
                var last = byMonth[^1].AverageRate;

                return new RateHistoryRow(
                    g.Key.MaterialId, g.Key.Code, g.Key.Name, g.Key.Unit,
                    first, last,
                    g.Min(l => l.UnitRate), g.Max(l => l.UnitRate),
                    Percent(last - first, first), g.Count(), byMonth);
            })
            .OrderByDescending(r => Math.Abs(r.ChangePercent))
            .ToList();
    }

    // ── stock nobody is touching ─────────────────────────────────────────────

    /// <summary>
    /// Material sitting at a site that nothing has been taken from for a long time.
    ///
    /// <para>Only outward movements count as "moved". A delivery arriving does not make old
    /// stock live — if anything it makes it worse, because now there is more of it.</para>
    /// </summary>
    public async Task<IReadOnlyList<DeadStockRow>> DeadStockAsync(
        Guid? siteId, int idleDays, CancellationToken ct)
    {
        var sites = PermittedSites();

        if (siteId is { } id && !me.CanSeeSite(id))
            throw AppException.Forbidden("You do not have access to that site.");

        var movements = db.StockMovements.AsNoTracking().AsQueryable();
        if (siteId is { } only) movements = movements.Where(m => m.SiteId == only);
        if (sites is not null) movements = movements.Where(m => sites.Contains(m.SiteId));

        var outward = new[]
        {
            MovementType.Consumed, MovementType.TransferOut, MovementType.Issued,
            MovementType.WrittenOff, MovementType.ReturnedToSupplier,
        };

        var balances = await movements
            .GroupBy(m => new { m.SiteId, SiteName = m.Site.Name, m.MaterialId, MaterialName = m.Material.Name, Unit = m.Material.Unit.Code })
            .Select(g => new
            {
                g.Key,
                OnHand = g.Sum(m => m.Quantity),
                LastOut = g.Where(m => outward.Contains(m.Type))
                    .Max(m => (DateTimeOffset?)m.OccurredAt),
                // Nothing has ever gone out, so it has been sitting since it turned up.
                FirstIn = g.Min(m => m.OccurredAt),
            })
            .Where(x => x.OnHand > 0)
            .ToListAsync(ct);

        if (balances.Count == 0) return [];

        var now = clock.GetUtcNow();
        var rates = await LastRatesAsync(balances.Select(b => b.Key.MaterialId).Distinct().ToList(), ct);

        return balances
            .Select(b => new
            {
                b.Key, b.OnHand, b.LastOut,
                Idle = (int)(now - (b.LastOut ?? b.FirstIn)).TotalDays,
            })
            .Where(b => b.Idle >= idleDays)
            .Select(b => new DeadStockRow(
                b.Key.SiteId, b.Key.SiteName, b.Key.MaterialId, b.Key.MaterialName, b.Key.Unit,
                Math.Round(b.OnHand, 3),
                Math.Round(b.OnHand * Rate(rates, b.Key.MaterialId), 2),
                b.Idle, b.LastOut))
            .OrderByDescending(r => r.Value)
            .ToList();
    }

    // ── how long things take ─────────────────────────────────────────────────

    /// <summary>
    /// Where the days go between somebody asking for material and it arriving.
    ///
    /// <para>Four stages, each measured only on requests that actually reached the next one,
    /// so a stage's average is not dragged by things still sitting in it.</para>
    /// </summary>
    public async Task<IReadOnlyList<CycleTimeRow>> CycleTimeAsync(
        DateOnly from, DateOnly to, CancellationToken ct)
    {
        var start = from.ToDateTime(TimeOnly.MinValue).ToUniversalTime();
        var end = to.AddDays(1).ToDateTime(TimeOnly.MinValue).ToUniversalTime();
        var sites = PermittedSites();

        var requisitions = db.Requisitions.AsNoTracking()
            .Where(r => r.SubmittedAt >= start && r.SubmittedAt < end);

        if (sites is not null) requisitions = requisitions.Where(r => sites.Contains(r.SiteId));

        var flat = await requisitions
            .Select(r => new
            {
                r.SubmittedAt, r.PricedAt, r.DecidedAt,
                FirstOrder = r.PurchaseOrders
                    .Where(o => o.Status != PurchaseOrderStatus.Cancelled)
                    .Min(o => (DateTimeOffset?)o.IssuedAt),
                FirstDelivery = db.GoodsReceipts
                    .Where(g => g.PurchaseOrder.RequisitionId == r.Id
                                && g.Status == GoodsReceiptStatus.Accepted)
                    .Min(g => (DateTimeOffset?)g.ReceivedAt),
            })
            .ToListAsync(ct);

        var stages = new List<CycleTimeRow>();

        Add("Waiting to be priced", flat.Select(r => Days(r.SubmittedAt, r.PricedAt)));
        Add("Waiting for approval", flat.Select(r => Days(r.PricedAt, r.DecidedAt)));
        Add("Approval to order sent", flat.Select(r => Days(r.DecidedAt, r.FirstOrder)));
        Add("Order to first delivery", flat.Select(r => Days(r.FirstOrder, r.FirstDelivery)));

        return stages;

        void Add(string stage, IEnumerable<double?> values)
        {
            var real = values.Where(v => v is not null).Select(v => v!.Value).ToList();
            if (real.Count == 0) return;

            stages.Add(new CycleTimeRow(
                stage, Math.Round(real.Average(), 1), Math.Round(real.Max(), 1), real.Count));
        }
    }

    /// <summary>
    /// How long each material actually takes to arrive, so a "needed by" date can be asked
    /// for with some idea of whether it is possible.
    /// </summary>
    public async Task<IReadOnlyList<LeadTimeRow>> LeadTimesAsync(
        DateOnly from, DateOnly to, CancellationToken ct)
    {
        var start = from.ToDateTime(TimeOnly.MinValue).ToUniversalTime();
        var end = to.AddDays(1).ToDateTime(TimeOnly.MinValue).ToUniversalTime();
        var sites = PermittedSites();

        var receipts = db.GoodsReceipts.AsNoTracking()
            .Where(g => g.Status == GoodsReceiptStatus.Accepted
                        && g.ReceivedAt >= start && g.ReceivedAt < end);

        if (sites is not null) receipts = receipts.Where(g => sites.Contains(g.SiteId));

        var flat = await receipts
            .SelectMany(g => g.Lines)
            .Where(l => l.AcceptedQuantity > 0)
            .Select(l => new
            {
                l.MaterialId,
                Name = l.Material.Name,
                Unit = l.Material.Unit.Code,
                Supplier = l.GoodsReceipt.PurchaseOrder.Supplier.Name,
                Issued = l.GoodsReceipt.PurchaseOrder.IssuedAt,
                Arrived = l.GoodsReceipt.ReceivedAt,
            })
            .ToListAsync(ct);

        return flat
            .Select(l => new { l.MaterialId, l.Name, l.Unit, l.Supplier, Days = (l.Arrived - l.Issued).TotalDays })
            .Where(l => l.Days >= 0)
            .GroupBy(l => new { l.MaterialId, l.Name, l.Unit })
            .Select(g =>
            {
                var slowest = g.OrderByDescending(l => l.Days).First();
                return new LeadTimeRow(
                    g.Key.MaterialId, g.Key.Name, g.Key.Unit,
                    Math.Round(g.Average(l => l.Days), 1),
                    Math.Round(slowest.Days, 1), g.Count(), slowest.Supplier);
            })
            .OrderByDescending(r => r.AverageLeadDays)
            .ToList();
    }

    // ── shared ───────────────────────────────────────────────────────────────

    /// <summary>
    /// The most recent rate paid for each material, for valuing quantities.
    ///
    /// <para>Last paid rather than average: the question a loss report answers is what it
    /// costs to replace, and that is today's price, not the mean of every price since 2024.</para>
    /// </summary>
    private async Task<Dictionary<Guid, decimal>> LastRatesAsync(
        List<Guid> materialIds, CancellationToken ct) =>
        await db.PurchaseOrderLines.AsNoTracking()
            .Where(l => materialIds.Contains(l.MaterialId)
                        && l.PurchaseOrder.Status != PurchaseOrderStatus.Cancelled)
            .GroupBy(l => l.MaterialId)
            .Select(g => new
            {
                Material = g.Key,
                Rate = g.OrderByDescending(l => l.PurchaseOrder.IssuedAt)
                    .Select(l => l.UnitRate).First(),
            })
            .ToDictionaryAsync(x => x.Material, x => x.Rate, ct);

    private static decimal Rate(Dictionary<Guid, decimal> rates, Guid materialId) =>
        rates.TryGetValue(materialId, out var rate) ? rate : 0m;

    private static double? Days(DateTimeOffset? from, DateTimeOffset? to) =>
        from is null || to is null ? null : Math.Max(0d, (to.Value - from.Value).TotalDays);

    private static double Percent(decimal part, decimal whole) =>
        whole == 0 ? 0d : (double)Math.Round(part / whole * 100m, 1);

    private static string Bucket(int daysLate) => daysLate switch
    {
        <= 0 => "Not due yet",
        <= 30 => "1-30 days late",
        <= 60 => "31-60 days late",
        <= 90 => "61-90 days late",
        _ => "Over 90 days late",
    };

    private static int BucketOrder(string bucket) => bucket switch
    {
        "Not due yet" => 0,
        "1-30 days late" => 1,
        "31-60 days late" => 2,
        "61-90 days late" => 3,
        _ => 4,
    };

    private static string Readable(string value) =>
        System.Text.RegularExpressions.Regex.Replace(value, "([a-z])([A-Z])", "$1 $2");
}
