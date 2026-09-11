using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Paging;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Billing;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Notifications;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Features.Notifications;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Invoices;

public sealed class InvoiceService(
    SiteStockDbContext db,
    ThreeWayMatcher matcher,
    NotificationService notifications,
    ICurrentUser me,
    TimeProvider clock,
    ILogger<InvoiceService> logger)
{
    // ── reading ──────────────────────────────────────────────────────────────

    public async Task<PagedResult<InvoiceListItem>> ListAsync(InvoiceQuery query, CancellationToken ct)
    {
        var page = new PageRequest { Page = query.Page ?? 1, PageSize = query.PageSize ?? 50 };
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

        var invoices = db.Invoices.AsNoTracking()
            .Include(i => i.Supplier)
            .Include(i => i.PurchaseOrder)
            .Include(i => i.Site)
            .Include(i => i.Variances)
            .AsSplitQuery()
            .AsQueryable();

        if (query.SiteId is { } siteId)
        {
            if (!me.CanSeeSite(siteId)) throw AppException.Forbidden("You do not have access to that site.");
            invoices = invoices.Where(i => i.SiteId == siteId);
        }
        else if (!me.HasAllSites)
        {
            var permitted = me.SiteIds.ToList();
            invoices = invoices.Where(i => permitted.Contains(i.SiteId));
        }

        if (!string.IsNullOrWhiteSpace(query.Status)
            && Enum.TryParse<InvoiceStatus>(query.Status, true, out var status))
        {
            invoices = invoices.Where(i => i.Status == status);
        }

        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var term = $"%{query.Q.Trim()}%";
            invoices = invoices.Where(i =>
                EF.Functions.ILike(i.SupplierInvoiceNumber, term) ||
                EF.Functions.ILike(i.Supplier.Name, term) ||
                EF.Functions.ILike(i.PurchaseOrder.Number, term));
        }

        if (query.NeedsAttention == true)
            invoices = invoices.Where(i => i.Variances.Any(v => v.ResolvedAt == null));

        var total = await invoices.CountAsync(ct);

        var items = await invoices
            // Anything with an unresolved difference first — that is what holds up payment.
            .OrderByDescending(i => i.Variances.Any(v => v.ResolvedAt == null))
            .ThenBy(i => i.DueDate)
            .Skip(page.Skip).Take(page.SafePageSize)
            .ToListAsync(ct);

        return new PagedResult<InvoiceListItem>(
            items.Select(i => new InvoiceListItem(
                i.Id, i.SupplierInvoiceNumber, i.Status.ToString(),
                i.SupplierId, i.Supplier.Name,
                i.PurchaseOrderId, i.PurchaseOrder.Number, i.Site.Name,
                i.InvoiceDate, i.DueDate, i.GrandTotal, i.PayableAmount,
                i.Variances.Count(v => v.ResolvedAt is null),
                i.Variances.Where(v => v.ResolvedAt is null).Sum(v => v.DifferenceAmount),
                i.DueDate.DayNumber - today.DayNumber)).ToList(),
            page.SafePage, page.SafePageSize, total);
    }

    public async Task<InvoiceDetail> GetAsync(Guid id, CancellationToken ct) =>
        await DescribeAsync(await LoadAsync(id, ct), ct);

    // ── writing ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Opens an entry form pre-filled from the order and what was accepted at the gate.
    ///
    /// This is the whole answer to dropping OCR: finance never types an invoice from a
    /// blank screen. They open the order, see what we think it should say, and change only
    /// what the supplier billed differently — which is a handful of keystrokes on a bill
    /// that matches, and exactly the differences that matter on one that does not.
    /// </summary>
    public async Task<InvoiceDetail> StartAsync(Guid purchaseOrderId, CancellationToken ct)
    {
        var order = await db.PurchaseOrders
            .Include(o => o.Site)
            .Include(o => o.Supplier)
            .Include(o => o.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
            .FirstOrDefaultAsync(o => o.Id == purchaseOrderId, ct)
            ?? throw AppException.NotFound("That purchase order");

        if (!me.CanSeeSite(order.SiteId))
            throw AppException.Forbidden("That order belongs to a site you do not have access to.");

        var existingDraft = await db.Invoices
            .FirstOrDefaultAsync(i => i.PurchaseOrderId == purchaseOrderId
                                      && i.Status == InvoiceStatus.Draft, ct);

        if (existingDraft is not null) return await GetAsync(existingDraft.Id, ct);

        var accepted = await AcceptedQuantitiesAsync(purchaseOrderId, ct);
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

        var invoice = new Invoice
        {
            SupplierInvoiceNumber = string.Empty,
            SupplierId = order.SupplierId,
            PurchaseOrderId = order.Id,
            SiteId = order.SiteId,
            Status = InvoiceStatus.Draft,
            InvoiceDate = today,
            DueDate = today.AddDays(order.PaymentTermsDays),
            EnteredById = me.Id,
        };

        db.Invoices.Add(invoice);

        var lines = new List<InvoiceLine>();

        foreach (var line in order.Lines)
        {
            accepted.TryGetValue(line.Id, out var acceptedQuantity);

            // Pre-filled with what we accepted at our agreed rate — the figure we expect
            // to see, so any keystroke finance makes is itself the variance.
            var lineTotal = Math.Round(acceptedQuantity * line.UnitRate, 2);

            var entity = new InvoiceLine
            {
                InvoiceId = invoice.Id,
                PurchaseOrderLineId = line.Id,
                MaterialId = line.MaterialId,
                BilledQuantity = acceptedQuantity,
                BilledRate = line.UnitRate,
                TaxPercent = line.TaxPercent,
                LineTotal = lineTotal,
                TaxAmount = Math.Round(lineTotal * line.TaxPercent / 100m, 2),
            };

            db.InvoiceLines.Add(entity);
            lines.Add(entity);
        }

        // From the in-memory lines: they are only in the change tracker at this point, so
        // querying the table here would sum an empty set and show a total of zero.
        Total(invoice, lines);
        await db.SaveChangesAsync(ct);

        return await GetAsync(invoice.Id, ct);
    }

    /// <summary>Saves what finance typed, then runs the match. The two always happen together.</summary>
    public async Task<InvoiceDetail> SaveAndMatchAsync(
        Guid id, SaveInvoiceRequest request, CancellationToken ct)
    {
        var invoice = await LoadAsync(id, ct);

        if (!invoice.IsEditable)
        {
            throw AppException.BadRequest("not_editable",
                $"This bill has been {invoice.Status.ToString().ToLowerInvariant()} and can no longer be changed.");
        }

        if (string.IsNullOrWhiteSpace(request.SupplierInvoiceNumber))
            throw AppException.BadRequest("number_required", "Enter the supplier's invoice number.");

        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        if (request.InvoiceDate > today)
            throw AppException.BadRequest("future_date", "The invoice is dated in the future.");

        if (request.Lines.Count == 0)
            throw AppException.BadRequest("no_lines", "A bill needs at least one line.");

        invoice.SupplierInvoiceNumber = request.SupplierInvoiceNumber.Trim();
        invoice.InvoiceDate = request.InvoiceDate;
        invoice.DueDate = request.InvoiceDate.AddDays(invoice.PurchaseOrder.PaymentTermsDays);
        invoice.Notes = request.Notes?.Trim();

        db.InvoiceLines.RemoveRange(invoice.Lines);
        invoice.Lines.Clear();

        var lines = new List<InvoiceLine>();

        foreach (var line in request.Lines)
        {
            if (line.BilledQuantity < 0 || line.BilledRate < 0)
                throw AppException.BadRequest("negative", "Quantities and rates cannot be negative.");

            var lineTotal = Math.Round(line.BilledQuantity * line.BilledRate, 2);

            var entity = new InvoiceLine
            {
                InvoiceId = invoice.Id,
                PurchaseOrderLineId = line.PurchaseOrderLineId,
                MaterialId = line.MaterialId,
                BilledQuantity = line.BilledQuantity,
                BilledRate = line.BilledRate,
                TaxPercent = line.TaxPercent,
                LineTotal = lineTotal,
                TaxAmount = Math.Round(lineTotal * line.TaxPercent / 100m, 2),
                Notes = line.Notes?.Trim(),
            };

            db.InvoiceLines.Add(entity);
            lines.Add(entity);
        }

        Total(invoice, lines);

        // A re-match replaces the machine's findings but keeps nothing resolved by hand —
        // the figures changed, so the old conclusions no longer describe this bill.
        db.InvoiceVariances.RemoveRange(invoice.Variances);
        invoice.Variances.Clear();

        await db.SaveChangesAsync(ct);

        // Reload so the matcher sees the saved lines with their material and unit.
        var reloaded = await LoadAsync(id, ct);
        var found = await matcher.MatchAsync(reloaded, ct);

        foreach (var variance in found) db.InvoiceVariances.Add(variance);

        reloaded.Variances = found;
        reloaded.PayableAmount = ThreeWayMatcher.CalculatePayable(reloaded);
        reloaded.MatchedAt = clock.GetUtcNow();
        reloaded.Status = found.Count == 0 ? InvoiceStatus.Matched : InvoiceStatus.Variance;

        await db.SaveChangesAsync(ct);

        if (found.Count > 0)
        {
            var held = found.Sum(v => v.DifferenceAmount);

            await notifications.RaiseForPermissionAsync(
                Permissions.PurchaseOrdersRead, reloaded.SiteId,
                NotificationKind.InvoiceVariance,
                $"{reloaded.Supplier.Name} billed \u20b9{held:N0} more than we owe",
                $"{reloaded.SupplierInvoiceNumber} against {reloaded.PurchaseOrder.Number} · " +
                $"{found.Count} difference(s). Nothing is paid until they are settled.",
                $"/bills/{reloaded.Id}", NotificationUrgency.Urgent, ct: ct);

            await db.SaveChangesAsync(ct);
        }

        logger.LogInformation("Matched {Invoice} against {Order}: {Count} variance(s), payable {Payable}",
            reloaded.SupplierInvoiceNumber, reloaded.PurchaseOrder.Number, found.Count, reloaded.PayableAmount);

        return await GetAsync(id, ct);
    }

    public async Task<InvoiceDetail> ResolveVarianceAsync(
        Guid id, Guid varianceId, ResolveVarianceRequest request, CancellationToken ct)
    {
        var invoice = await LoadAsync(id, ct);

        var variance = invoice.Variances.FirstOrDefault(v => v.Id == varianceId)
                       ?? throw AppException.NotFound("That difference");

        if (!variance.IsOpen)
            throw AppException.BadRequest("already_resolved", "That difference has already been settled.");

        if (!Enum.TryParse<VarianceResolution>(request.Resolution, true, out var resolution))
            throw AppException.BadRequest("unknown_resolution", "Choose what to do about it.");

        if (string.IsNullOrWhiteSpace(request.Notes))
        {
            throw AppException.BadRequest("notes_required",
                "Say why. Somebody will ask in six months why this supplier was paid what they were.");
        }

        variance.Resolution = resolution;
        variance.ResolutionNotes = request.Notes.Trim();
        variance.ResolvedAt = clock.GetUtcNow();
        variance.ResolvedById = me.Id;

        // Disputing one line disputes the bill: nothing is paid until the supplier re-issues.
        if (resolution == VarianceResolution.DisputeWithSupplier)
            invoice.Status = InvoiceStatus.Disputed;

        invoice.PayableAmount = ThreeWayMatcher.CalculatePayable(invoice);

        if (invoice.Status != InvoiceStatus.Disputed && !invoice.HasOpenVariances)
            invoice.Status = InvoiceStatus.Matched;

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    /// <summary>
    /// Releases the payment. The rule the whole phase exists for: <b>nothing is released
    /// while a difference is unexplained</b>.
    /// </summary>
    public async Task<InvoiceDetail> ReleaseAsync(
        Guid id, ReleasePaymentRequest request, CancellationToken ct)
    {
        var invoice = await LoadAsync(id, ct);

        if (invoice.Status == InvoiceStatus.Disputed)
        {
            throw AppException.BadRequest("disputed",
                "This bill is disputed. Nothing is paid until the supplier re-issues it.");
        }

        if (invoice.Status is InvoiceStatus.Approved or InvoiceStatus.Paid)
            throw AppException.BadRequest("already_released", "This bill has already been released.");

        if (invoice.HasOpenVariances)
        {
            var open = invoice.Variances.Count(v => v.IsOpen);
            var amount = invoice.Variances.Where(v => v.IsOpen).Sum(v => v.DifferenceAmount);

            throw AppException.BadRequest("open_variances",
                $"{open} difference{(open == 1 ? "" : "s")} worth ₹{amount:N2} " +
                $"{(open == 1 ? "is" : "are")} still unexplained. Settle {(open == 1 ? "it" : "them")} first — " +
                "that is the entire point of checking the bill.");
        }

        if (invoice.MatchedAt is null)
            throw AppException.BadRequest("not_matched", "This bill has not been checked against the order yet.");

        invoice.Status = InvoiceStatus.Approved;
        invoice.ApprovedAt = clock.GetUtcNow();
        invoice.ApprovedById = me.Id;
        invoice.PaymentReference = request.Reference?.Trim();

        await db.SaveChangesAsync(ct);

        logger.LogInformation("Released {Invoice} for payment: {Payable} of {Billed} billed",
            invoice.SupplierInvoiceNumber, invoice.PayableAmount, invoice.GrandTotal);

        return await GetAsync(id, ct);
    }

    /// <summary>
    /// Records money that actually left the account.
    ///
    /// <para>Separate from releasing the bill because they are separate acts, often days
    /// apart and done by different people. A bill is only paid when the payments against it
    /// add up to what was payable — which is what makes part payment, and a retention held
    /// back at the end, something the system can represent honestly.</para>
    /// </summary>
    public async Task<InvoiceDetail> RecordPaymentAsync(
        Guid id, RecordPaymentRequest request, CancellationToken ct)
    {
        var invoice = await LoadAsync(id, ct);

        if (invoice.Status == InvoiceStatus.Disputed)
        {
            throw AppException.BadRequest("disputed",
                "This bill is disputed. Nothing is paid until the supplier re-issues it.");
        }

        if (invoice.ApprovedAt is null)
        {
            throw AppException.BadRequest("not_released",
                "This bill has not been released for payment yet. Check it against the order first.");
        }

        if (request.Amount <= 0)
            throw AppException.BadRequest("bad_amount", "A payment has to be more than zero.");

        var alreadyPaid = invoice.Payments.Sum(p => p.Amount);
        var outstanding = invoice.PayableAmount - alreadyPaid;

        if (request.Amount > outstanding)
        {
            throw AppException.BadRequest("over_payment",
                $"Only ₹{outstanding:N2} is still outstanding on this bill. "
                + "Paying more than is owed is how a supplier ledger stops reconciling.");
        }

        if (!Enum.TryParse<PaymentMethod>(request.Method, true, out var method))
            throw AppException.BadRequest("unknown_method", $"There is no payment method called '{request.Method}'.");

        var now = clock.GetUtcNow();

        db.SupplierPayments.Add(new SupplierPayment
        {
            InvoiceId = invoice.Id,
            SupplierId = invoice.SupplierId,
            SiteId = invoice.SiteId,
            Amount = request.Amount,
            PaidOn = request.PaidOn,
            Method = method,
            Reference = request.Reference?.Trim(),
            Notes = request.Notes?.Trim(),
            RecordedById = me.Id,
        });

        // Settled to the rupee, so it stops appearing as owed. Anything short of that stays
        // open and keeps showing an outstanding balance, which is the point.
        if (alreadyPaid + request.Amount >= invoice.PayableAmount)
        {
            invoice.Status = InvoiceStatus.Paid;
            invoice.PaidAt = now;
            invoice.PaymentReference ??= request.Reference?.Trim();
        }

        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Paid {Amount} against {Invoice} by {Method} ({Reference}) — {Outstanding} left",
            request.Amount, invoice.SupplierInvoiceNumber, method, request.Reference,
            outstanding - request.Amount);

        return await GetAsync(id, ct);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static void Total(Invoice invoice, IEnumerable<InvoiceLine> lines)
    {
        var list = lines.ToList();
        invoice.SubTotal = list.Sum(l => l.LineTotal);
        invoice.TaxTotal = list.Sum(l => l.TaxAmount);
        invoice.GrandTotal = invoice.SubTotal + invoice.TaxTotal;
        invoice.PayableAmount = invoice.GrandTotal;
    }

    private async Task<Dictionary<Guid, decimal>> AcceptedQuantitiesAsync(
        Guid purchaseOrderId, CancellationToken ct)
    {
        var rows = await db.GoodsReceiptLines
            .AsNoTracking()
            .Where(l => l.GoodsReceipt.PurchaseOrderId == purchaseOrderId
                        && l.GoodsReceipt.Status == GoodsReceiptStatus.Accepted)
            .GroupBy(l => l.PurchaseOrderLineId)
            .Select(g => new { LineId = g.Key, Quantity = g.Sum(l => l.AcceptedQuantity) })
            .ToListAsync(ct);

        return rows.ToDictionary(r => r.LineId, r => r.Quantity);
    }

    private async Task<Invoice> LoadAsync(Guid id, CancellationToken ct)
    {
        var invoice = await db.Invoices
            .Include(i => i.Supplier)
            .Include(i => i.Site)
            .Include(i => i.EnteredBy)
            .Include(i => i.ApprovedBy)
            .Include(i => i.PurchaseOrder).ThenInclude(o => o.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
            .Include(i => i.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
            .Include(i => i.Variances).ThenInclude(v => v.ResolvedBy)
            .Include(i => i.Payments).ThenInclude(p => p.RecordedBy)
            .AsSplitQuery()
            .FirstOrDefaultAsync(i => i.Id == id, ct)
            ?? throw AppException.NotFound("That invoice");

        if (!me.CanSeeSite(invoice.SiteId))
            throw AppException.Forbidden("That bill belongs to a site you do not have access to.");

        return invoice;
    }

    private async Task<InvoiceDetail> DescribeAsync(Invoice i, CancellationToken ct)
    {
        var accepted = await AcceptedQuantitiesAsync(i.PurchaseOrderId, ct);
        var orderLines = i.PurchaseOrder.Lines.ToDictionary(l => l.Id);

        var lines = i.Lines
            .OrderBy(l => l.Material.Category).ThenBy(l => l.Material.Name)
            .Select(l =>
            {
                var ordered = l.PurchaseOrderLineId is { } id && orderLines.TryGetValue(id, out var o) ? o : null;
                accepted.TryGetValue(l.PurchaseOrderLineId ?? Guid.Empty, out var acceptedQuantity);

                var matches = ordered is not null
                    && Math.Abs(l.BilledQuantity - acceptedQuantity) <= 0.001m
                    && Math.Abs(l.BilledRate - ordered.UnitRate) <= 0.001m
                    && Math.Abs(l.TaxPercent - ordered.TaxPercent) <= 0.01m;

                return new InvoiceLineDto(
                    l.Id, l.PurchaseOrderLineId, l.MaterialId,
                    l.Material.Code, l.Material.Name, l.Material.Unit.Code, l.Material.Unit.DecimalPlaces,
                    ordered?.Quantity ?? 0m, ordered?.UnitRate ?? 0m, ordered?.TaxPercent ?? 0m,
                    acceptedQuantity,
                    l.BilledQuantity, l.BilledRate, l.TaxPercent,
                    l.LineTotal, l.TaxAmount, l.Notes, matches);
            })
            .ToList();

        var actions = new List<string>();
        if (i.IsEditable && me.Can(Permissions.InvoicesEnter)) actions.Add("Save");
        if (i.HasOpenVariances && me.Can(Permissions.InvoicesMatch)) actions.Add("Resolve");
        if (!i.HasOpenVariances && i.MatchedAt is not null
            && i.Status is InvoiceStatus.Matched or InvoiceStatus.Variance
            && me.Can(Permissions.PaymentsRelease)) actions.Add("Release");

        return new InvoiceDetail(
            i.Id, i.SupplierInvoiceNumber, i.Status.ToString(),
            i.SupplierId, i.Supplier.Name, i.Supplier.Gstin,
            i.PurchaseOrderId, i.PurchaseOrder.Number,
            i.SiteId, i.Site.Name,
            i.InvoiceDate, i.DueDate, i.PurchaseOrder.PaymentTermsDays,
            i.PurchaseOrder.GrandTotal,
            lines.Sum(l => Math.Round(l.AcceptedQuantity * l.OrderedRate * (1 + l.OrderedTaxPercent / 100m), 2)),
            i.SubTotal, i.TaxTotal, i.GrandTotal, i.PayableAmount,
            i.EnteredBy.FullName, i.MatchedAt,
            i.ApprovedBy?.FullName, i.ApprovedAt,
            i.PaidAt, i.PaymentReference,
            i.Notes, i.IsEditable,
            lines,
            i.Variances
                .OrderBy(v => v.ResolvedAt.HasValue).ThenByDescending(v => Math.Abs(v.DifferenceAmount))
                .Select(v => new VarianceDto(
                    v.Id, v.Type.ToString(), Label(v.Type), v.MaterialName,
                    v.ExpectedValue, v.BilledValue, v.DifferenceAmount, v.Description,
                    v.Resolution?.ToString(), v.ResolutionNotes, v.ResolvedAt,
                    v.ResolvedBy?.FullName, v.IsOpen))
                .ToList(),
            i.Payments
                .OrderBy(p => p.PaidOn).ThenBy(p => p.CreatedAt)
                .Select(p => new PaymentDto(
                    p.Id, p.Amount, p.PaidOn, p.Method.ToString(),
                    p.Reference, p.Notes, p.RecordedBy.FullName, p.CreatedAt))
                .ToList(),
            i.AmountPaid, i.Outstanding,
            i.HasOpenVariances,
            actions);
    }

    private static string Label(VarianceType type) => type switch
    {
        VarianceType.QuantityMismatch => "Billed for more than arrived",
        VarianceType.PriceMismatch => "Rate differs from the order",
        VarianceType.MissingItems => "Not on the order",
        VarianceType.WrongPoReference => "Wrong order number",
        VarianceType.TaxMismatch => "GST differs from the order",
        VarianceType.DuplicateInvoice => "Already billed",
        _ => type.ToString(),
    };
}
