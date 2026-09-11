using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Paging;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Documents;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Domain.Notifications;
using SiteStock.Api.Features.Inventory;
using SiteStock.Api.Features.Notifications;
using SiteStock.Api.Features.Settings;
using SiteStock.Api.Domain.Configuration;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Receiving;

public sealed class ReceivingService(
    SiteStockDbContext db,
    DocumentNumberService numbers,
    StockLedger ledger,
    SettingsService settings,
    NotificationService notifications,
    ICurrentUser me,
    TimeProvider clock,
    ILogger<ReceivingService> logger)
{
    // ── reading ──────────────────────────────────────────────────────────────

    public async Task<PagedResult<GoodsReceiptListItem>> ListAsync(
        Guid? siteId, string? status, int page, int pageSize, CancellationToken ct)
    {
        var request = new PageRequest { Page = page, PageSize = pageSize };

        var receipts = db.GoodsReceipts.AsNoTracking()
            .Include(g => g.Site)
            .Include(g => g.PurchaseOrder).ThenInclude(o => o.Supplier)
            .Include(g => g.ReceivedBy)
            .Include(g => g.Lines)
            .AsSplitQuery()
            .AsQueryable();

        if (siteId is { } id)
        {
            if (!me.CanSeeSite(id)) throw AppException.Forbidden("You do not have access to that site.");
            receipts = receipts.Where(g => g.SiteId == id);
        }
        else if (!me.HasAllSites)
        {
            var permitted = me.SiteIds.ToList();
            receipts = receipts.Where(g => permitted.Contains(g.SiteId));
        }

        if (!string.IsNullOrWhiteSpace(status)
            && Enum.TryParse<GoodsReceiptStatus>(status, true, out var parsed))
        {
            receipts = receipts.Where(g => g.Status == parsed);
        }

        var total = await receipts.CountAsync(ct);

        var items = await receipts
            .OrderByDescending(g => g.ReceivedAt)
            .Skip(request.Skip).Take(request.SafePageSize)
            .ToListAsync(ct);

        return new PagedResult<GoodsReceiptListItem>(
            items.Select(g => new GoodsReceiptListItem(
                g.Id, g.Number, g.Status.ToString(), g.SiteId, g.Site.Code, g.Site.Name,
                g.PurchaseOrderId, g.PurchaseOrder.Number, g.PurchaseOrder.Supplier.Name,
                g.ReceivedAt, g.ReceivedBy.FullName, g.Lines.Count,
                g.Lines.Any(l => l.ReceivedQuantity < l.OrderedQuantity),
                g.Lines.Any(l => l.AcceptedQuantity < l.ReceivedQuantity)
                    || g.Status == GoodsReceiptStatus.Rejected)).ToList(),
            request.SafePage, request.SafePageSize, total);
    }

    public async Task<GoodsReceiptDetail> GetAsync(Guid id, CancellationToken ct) =>
        await DescribeAsync(await LoadAsync(id, ct), ct);

    // ── writing ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Opens a receipt against an order, pre-filled with what is still outstanding.
    ///
    /// Pre-filling matters: a supervisor at a gate with a lorry waiting should be confirming
    /// a number, not calculating one. The outstanding figure already accounts for whatever
    /// earlier deliveries against the same order were accepted.
    /// </summary>
    public async Task<GoodsReceiptDetail> StartAsync(Guid purchaseOrderId, CancellationToken ct)
    {
        var order = await db.PurchaseOrders
            .Include(o => o.Site)
            .Include(o => o.Supplier)
            .Include(o => o.Lines).ThenInclude(l => l.Material)
            .FirstOrDefaultAsync(o => o.Id == purchaseOrderId, ct)
            ?? throw AppException.NotFound("That purchase order");

        if (!me.CanSeeSite(order.SiteId))
            throw AppException.Forbidden("That order belongs to a site you do not have access to.");

        if (order.Status is PurchaseOrderStatus.Cancelled or PurchaseOrderStatus.Closed)
            throw AppException.BadRequest("order_closed", $"{order.Number} is {order.Status.ToString().ToLowerInvariant()}.");

        var existingDraft = await db.GoodsReceipts
            .FirstOrDefaultAsync(g => g.PurchaseOrderId == purchaseOrderId
                                      && g.Status == GoodsReceiptStatus.Draft, ct);

        if (existingDraft is not null)
        {
            // Two people counting the same lorry produce two truths. Send the second one
            // to the count already in progress instead.
            return await GetAsync(existingDraft.Id, ct);
        }

        var alreadyAccepted = await AlreadyAcceptedAsync(purchaseOrderId, ct);

        var receipt = new GoodsReceipt
        {
            Number = await numbers.NextAsync("GRN", order.Site.Code, ct),
            PurchaseOrderId = order.Id,
            SiteId = order.SiteId,
            Status = GoodsReceiptStatus.Draft,
            ReceivedById = me.Id,
            ReceivedAt = clock.GetUtcNow(),
        };

        db.GoodsReceipts.Add(receipt);

        foreach (var line in order.Lines)
        {
            alreadyAccepted.TryGetValue(line.Id, out var received);
            var outstanding = Math.Max(0m, line.Quantity - received);

            db.GoodsReceiptLines.Add(new GoodsReceiptLine
            {
                GoodsReceiptId = receipt.Id,
                PurchaseOrderLineId = line.Id,
                MaterialId = line.MaterialId,
                OrderedQuantity = line.Quantity,
                ReceivedQuantity = outstanding,
                AcceptedQuantity = outstanding,
            });
        }

        await db.SaveChangesAsync(ct);
        return await GetAsync(receipt.Id, ct);
    }

    public async Task<GoodsReceiptDetail> UpdateAsync(
        Guid id, SaveReceiptRequest request, CancellationToken ct)
    {
        var receipt = await LoadAsync(id, ct);
        EnsureEditable(receipt);

        var allowOver = await settings.GetBoolAsync(SettingKeys.AllowOverReceipt, false, ct);
        var byId = receipt.Lines.ToDictionary(l => l.Id);

        foreach (var line in request.Lines)
        {
            if (!byId.TryGetValue(line.LineId, out var existing))
                throw AppException.BadRequest("unknown_line", "A line does not belong to this receipt.");

            if (line.ReceivedQuantity < 0 || line.AcceptedQuantity < 0)
                throw AppException.BadRequest("negative_quantity", "Quantities cannot be negative.");

            // You cannot accept more than turned up. This is the rule that stops a
            // mis-tap turning into phantom stock.
            if (line.AcceptedQuantity > line.ReceivedQuantity)
            {
                throw AppException.BadRequest("accepted_exceeds_received",
                    $"You cannot accept more {existing.Material.Name} than arrived. " +
                    $"{line.ReceivedQuantity} arrived, {line.AcceptedQuantity} entered as accepted.");
            }

            if (!allowOver && line.ReceivedQuantity > existing.OrderedQuantity)
            {
                throw AppException.BadRequest("over_receipt",
                    $"{line.ReceivedQuantity} of {existing.Material.Name} is more than the " +
                    $"{existing.OrderedQuantity} ordered. Raise a new requisition for the extra, " +
                    "or turn on over-receipt in Settings if this is normal for you.");
            }

            existing.ReceivedQuantity = line.ReceivedQuantity;
            existing.AcceptedQuantity = line.AcceptedQuantity;
            existing.Notes = line.Notes?.Trim();
        }

        receipt.ChallanNumber = request.ChallanNumber?.Trim();
        receipt.ChallanDate = request.ChallanDate;
        receipt.VehicleNumber = request.VehicleNumber?.Trim().ToUpperInvariant();
        receipt.DriverName = request.DriverName?.Trim();
        receipt.CheckedMaterialMatches = request.CheckedMaterialMatches;
        receipt.CheckedQuantityMatches = request.CheckedQuantityMatches;
        receipt.CheckedConditionAcceptable = request.CheckedConditionAcceptable;
        receipt.CheckedCertificatePresent = request.CheckedCertificatePresent;
        receipt.Notes = request.Notes?.Trim();

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    /// <summary>
    /// Accept the delivery. This is the moment stock exists — one ledger row per accepted
    /// line, written in the same transaction as the status change, so there is no window
    /// in which a receipt is accepted but the stock is not there.
    /// </summary>
    public async Task<GoodsReceiptDetail> AcceptAsync(
        Guid id, AcceptReceiptRequest request, CancellationToken ct)
    {
        var receipt = await LoadAsync(id, ct);
        EnsureEditable(receipt);

        if (!receipt.AllChecksDone)
        {
            throw AppException.BadRequest("checks_incomplete",
                "Tick all four checks before accepting. If one of them is not true, reject the delivery instead.");
        }

        if (receipt.Lines.All(l => l.AcceptedQuantity <= 0))
        {
            throw AppException.BadRequest("nothing_accepted",
                "Nothing is being accepted. Reject the delivery instead, with photos.");
        }

        var missing = await MissingCertificatesAsync(receipt, ct);
        if (missing.Count > 0 && await settings.GetBoolAsync(SettingKeys.RequireCertificateOnReceipt, true, ct))
        {
            throw AppException.BadRequest("certificate_missing",
                $"Attach the test or mill certificate for {string.Join(", ", missing)} before accepting. " +
                "You cannot retrofit a document nobody captured.");
        }

        var isShort = receipt.Lines.Any(l => l.ReceivedQuantity < l.OrderedQuantity);

        if (isShort)
        {
            if (!Enum.TryParse<ShortfallDecision>(request.Shortfall, true, out var decision)
                || decision == ShortfallDecision.NotApplicable)
            {
                throw AppException.BadRequest("shortfall_decision_required",
                    "Less arrived than was ordered. Say whether the balance is still coming " +
                    "(hold the order open) or whether it is written off (close it short).");
            }

            receipt.Shortfall = decision;
        }

        var now = clock.GetUtcNow();

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        foreach (var line in receipt.Lines.Where(l => l.AcceptedQuantity > 0))
        {
            ledger.Append(
                receipt.SiteId, line.MaterialId, MovementType.Received,
                line.AcceptedQuantity,
                nameof(GoodsReceipt), receipt.Id, receipt.Number,
                me.Id, now,
                line.AcceptedQuantity < line.ReceivedQuantity
                    ? $"{line.RejectedQuantity} rejected at the gate"
                    : null);
        }

        receipt.Status = GoodsReceiptStatus.Accepted;
        receipt.DecidedAt = now;

        // A short or partly-refused delivery is the purchase head's problem, not the
        // supervisor's — he is the one who has to go back to the supplier.
        var shortLines = receipt.Lines.Where(l => l.ShortQuantity > 0).ToList();
        var overLines = receipt.Lines.Where(l => l.ShortQuantity < 0).ToList();
        var refused = receipt.Lines.Where(l => l.RejectedQuantity > 0).ToList();
        var closedShort = receipt.Shortfall == ShortfallDecision.CloseShort;

        if (shortLines.Count > 0 || overLines.Count > 0 || refused.Count > 0)
        {
            var parts = new List<string>();
            if (shortLines.Count > 0) parts.Add($"{shortLines.Count} line(s) short of the order");
            if (overLines.Count > 0) parts.Add($"{overLines.Count} line(s) over the order");
            if (refused.Count > 0) parts.Add($"{refused.Count} line(s) partly refused at the gate");

            var tail = shortLines.Count == 0
                ? string.Empty
                : closedShort
                    ? ". The order was closed short."
                    : ". The order is being held open for the balance.";

            // The purchase head chases every mismatch — he is the one who rings the supplier.
            await notifications.RaiseForPermissionAsync(
                Permissions.GoodsRejectReview, receipt.SiteId,
                NotificationKind.DeliveryShort,
                $"{receipt.Number} from {receipt.PurchaseOrder.Supplier.Name} did not match the order",
                string.Join(" · ", parts) + tail,
                $"/deliveries/{receipt.Id}", NotificationUrgency.Normal,
                alsoEmail: true, ct: ct);

            // The owner hears about the ones that cost money rather than time. A balance
            // still on its way is the purchase head's to chase; material written off, or
            // refused at the gate on an order the owner approved, is the owner's to know
            // about. Telling them about every late half-load is how alerts get ignored.
            if (closedShort || refused.Count > 0)
            {
                var why = new List<string>();
                if (closedShort) why.Add($"{shortLines.Count} line(s) written off short");
                if (refused.Count > 0) why.Add($"{refused.Count} line(s) refused at the gate");

                await notifications.RaiseForPermissionAsync(
                    Permissions.PurchasesApprove, receipt.SiteId,
                    NotificationKind.DeliveryShort,
                    $"{receipt.PurchaseOrder.Number} did not arrive in full",
                    $"{string.Join(" · ", why)} on the order you approved to "
                    + $"{receipt.PurchaseOrder.Supplier.Name} for {receipt.Site.Name}.",
                    $"/deliveries/{receipt.Id}", NotificationUrgency.Normal,
                    alsoEmail: true, ct: ct);
            }
        }

        await UpdateOrderStatusAsync(receipt, ct);

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        logger.LogInformation("{Number} accepted at {Site}; {Lines} line(s) entered stock",
            receipt.Number, receipt.SiteId, receipt.Lines.Count(l => l.AcceptedQuantity > 0));

        return await GetAsync(id, ct);
    }

    /// <summary>
    /// Reject the whole delivery. Nothing enters stock, and photographs are mandatory —
    /// a rejection without proof is an argument with a supplier that you lose.
    /// </summary>
    public async Task<GoodsReceiptDetail> RejectAsync(
        Guid id, RejectReceiptRequest request, CancellationToken ct)
    {
        var receipt = await LoadAsync(id, ct);
        EnsureEditable(receipt);

        if (!Enum.TryParse<RejectionReason>(request.Reason, true, out var reason))
            throw AppException.BadRequest("unknown_reason", "Choose a reason for the rejection.");

        if (string.IsNullOrWhiteSpace(request.Notes))
            throw AppException.BadRequest("notes_required", "Describe what is wrong, in your own words.");

        var minimum = await settings.GetAsync(SettingKeys.MinRejectionPhotos, 2, ct);

        var photos = await db.Documents.CountAsync(
            d => d.OwnerType == nameof(GoodsReceipt) && d.OwnerId == receipt.Id
                 && d.Kind == DocumentKind.RejectionPhoto, ct);

        if (photos < minimum)
        {
            throw AppException.BadRequest("photos_required",
                $"Attach at least {minimum} photo{(minimum == 1 ? "" : "s")} of the problem before rejecting. " +
                $"You have {photos}. Without proof this becomes your word against the supplier's.");
        }

        receipt.Status = GoodsReceiptStatus.Rejected;
        receipt.RejectionReason = reason;
        receipt.RejectionNotes = request.Notes.Trim();
        receipt.DecidedAt = clock.GetUtcNow();

        // Urgent by definition: a lorry has been turned away, the site still has nothing,
        // and somebody has to ring the supplier today.
        await notifications.RaiseForPermissionAsync(
            Permissions.GoodsRejectReview, receipt.SiteId,
            NotificationKind.DeliveryRejected,
            $"{receipt.Number} was refused — {receipt.PurchaseOrder.Supplier.Name}",
            $"{Readable(reason)}. {request.Notes.Trim()}",
            $"/deliveries/{receipt.Id}", NotificationUrgency.Urgent,
            alsoEmail: true, ct: ct);

        // A whole load turned away is an order the owner approved that delivered nothing.
        await notifications.RaiseForPermissionAsync(
            Permissions.PurchasesApprove, receipt.SiteId,
            NotificationKind.DeliveryRejected,
            $"{receipt.PurchaseOrder.Number} delivered nothing — the load was refused",
            $"{Readable(reason)} at {receipt.Site.Name}. {request.Notes.Trim()}",
            $"/deliveries/{receipt.Id}", NotificationUrgency.Urgent,
            alsoEmail: true, ct: ct);

        // Nothing enters stock, and the order goes back to waiting for a delivery.
        foreach (var line in receipt.Lines) line.AcceptedQuantity = 0m;

        await db.SaveChangesAsync(ct);

        logger.LogWarning("{Number} rejected: {Reason} — {Notes}", receipt.Number, reason, request.Notes);

        return await GetAsync(id, ct);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private async Task<GoodsReceipt> LoadAsync(Guid id, CancellationToken ct)
    {
        var receipt = await db.GoodsReceipts
            .Include(g => g.Site)
            .Include(g => g.ReceivedBy)
            .Include(g => g.PurchaseOrder).ThenInclude(o => o.Supplier)
            .Include(g => g.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
            .Include(g => g.Lines).ThenInclude(l => l.PurchaseOrderLine)
            .AsSplitQuery()
            .FirstOrDefaultAsync(g => g.Id == id, ct)
            ?? throw AppException.NotFound("That goods receipt");

        if (!me.CanSeeSite(receipt.SiteId))
            throw AppException.Forbidden("That receipt belongs to a site you do not have access to.");

        return receipt;
    }

    private static string Readable(RejectionReason reason) => reason switch
    {
        RejectionReason.WrongMaterial => "Wrong material sent",
        RejectionReason.DamagedInTransit => "Damaged in transit",
        RejectionReason.QualityBelowSpecification => "Quality below specification",
        RejectionReason.ShortWeightOrCount => "Short weight or count",
        RejectionReason.NoCertificate => "No test or mill certificate",
        RejectionReason.WrongSiteOrOrder => "Delivered to the wrong site or order",
        _ => "Refused",
    };

    private static void EnsureEditable(GoodsReceipt receipt)
    {
        if (!receipt.IsEditable)
        {
            throw AppException.BadRequest("already_decided",
                $"{receipt.Number} has already been {receipt.Status.ToString().ToLowerInvariant()}. " +
                "A receipt is never edited afterwards — record a stock adjustment instead.");
        }
    }

    private async Task<Dictionary<Guid, decimal>> AlreadyAcceptedAsync(
        Guid purchaseOrderId, CancellationToken ct)
    {
        var rows = await db.GoodsReceiptLines
            .Where(l => l.GoodsReceipt.PurchaseOrderId == purchaseOrderId
                        && l.GoodsReceipt.Status == GoodsReceiptStatus.Accepted)
            .GroupBy(l => l.PurchaseOrderLineId)
            .Select(g => new { LineId = g.Key, Quantity = g.Sum(l => l.AcceptedQuantity) })
            .ToListAsync(ct);

        return rows.ToDictionary(r => r.LineId, r => r.Quantity);
    }

    private async Task<List<string>> MissingCertificatesAsync(GoodsReceipt receipt, CancellationToken ct)
    {
        var needing = receipt.Lines
            .Where(l => l.Material.RequiresCertificate && l.AcceptedQuantity > 0)
            .Select(l => l.Material.Name)
            .ToList();

        if (needing.Count == 0) return [];

        var hasCertificate = await db.Documents.AnyAsync(
            d => d.OwnerType == nameof(GoodsReceipt) && d.OwnerId == receipt.Id
                 && d.Kind == DocumentKind.TestCertificate, ct);

        return hasCertificate ? [] : needing;
    }

    /// <summary>
    /// Moves the order on: fully received closes it, a shortfall held open leaves it
    /// partially received, and a shortfall closed short closes it at what arrived.
    /// </summary>
    private async Task UpdateOrderStatusAsync(GoodsReceipt receipt, CancellationToken ct)
    {
        var order = await db.PurchaseOrders
            .Include(o => o.Lines)
            .FirstAsync(o => o.Id == receipt.PurchaseOrderId, ct);

        var accepted = await AlreadyAcceptedAsync(order.Id, ct);

        foreach (var line in receipt.Lines)
        {
            accepted.TryGetValue(line.PurchaseOrderLineId, out var previous);
            accepted[line.PurchaseOrderLineId] = previous + line.AcceptedQuantity;
        }

        var fullyReceived = order.Lines.All(l =>
            accepted.TryGetValue(l.Id, out var got) && got >= l.Quantity);

        order.Status = fullyReceived
            ? PurchaseOrderStatus.Received
            : receipt.Shortfall == ShortfallDecision.CloseShort
                ? PurchaseOrderStatus.Closed
                : PurchaseOrderStatus.PartiallyReceived;
    }

    private async Task<GoodsReceiptDetail> DescribeAsync(GoodsReceipt g, CancellationToken ct)
    {
        var alreadyAccepted = await AlreadyAcceptedAsync(g.PurchaseOrderId, ct);

        var documents = await db.Documents
            .AsNoTracking()
            .Include(d => d.UploadedBy)
            .Where(d => d.OwnerType == nameof(GoodsReceipt) && d.OwnerId == g.Id)
            .OrderBy(d => d.CreatedAt)
            .ToListAsync(ct);

        var lines = g.Lines
            .OrderBy(l => l.Material.Category).ThenBy(l => l.Material.Name)
            .Select(l =>
            {
                // Exclude this receipt's own contribution when it has already been accepted,
                // otherwise reopening an accepted receipt would double-count it.
                alreadyAccepted.TryGetValue(l.PurchaseOrderLineId, out var accepted);
                if (g.Status == GoodsReceiptStatus.Accepted) accepted -= l.AcceptedQuantity;

                return new ReceiptLineDto(
                    l.Id, l.PurchaseOrderLineId, l.MaterialId,
                    l.Material.Code, l.Material.Name, l.Material.Specification,
                    l.Material.Unit.Code, l.Material.Unit.DecimalPlaces, l.Material.RequiresCertificate,
                    l.OrderedQuantity, accepted, Math.Max(0m, l.OrderedQuantity - accepted),
                    l.ReceivedQuantity, l.AcceptedQuantity,
                    l.RejectedQuantity, l.ShortQuantity,
                    l.PurchaseOrderLine.UnitRate, l.Notes);
            })
            .ToList();

        return new GoodsReceiptDetail(
            g.Id, g.Number, g.Status.ToString(),
            g.SiteId, g.Site.Code, g.Site.Name,
            g.PurchaseOrderId, g.PurchaseOrder.Number, g.PurchaseOrder.Supplier.Name,
            g.PurchaseOrder.Supplier.PhoneNumber,
            g.ReceivedAt, g.ReceivedBy.FullName,
            g.ChallanNumber, g.ChallanDate, g.VehicleNumber, g.DriverName,
            g.CheckedMaterialMatches, g.CheckedQuantityMatches,
            g.CheckedConditionAcceptable, g.CheckedCertificatePresent,
            g.Shortfall.ToString(), g.RejectionReason?.ToString(), g.RejectionNotes, g.Notes,
            g.DecidedAt, g.IsEditable,
            lines,
            documents.Select(d => new ReceiptDocumentDto(
                d.Id, d.Kind.ToString(), d.FileName, d.ContentType, d.SizeBytes,
                d.Caption, d.CreatedAt, d.UploadedBy.FullName)).ToList(),
            lines.Any(l => l.ReceivedQuantity < l.OrderedQuantity),
            await MissingCertificatesAsync(g, ct));
    }
}
