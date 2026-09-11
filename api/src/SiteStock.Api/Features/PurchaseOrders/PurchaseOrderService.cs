using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Paging;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Configuration;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Notifications;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Features.Notifications;
using SiteStock.Api.Features.Settings;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.PurchaseOrders;

public sealed class PurchaseOrderService(
    SiteStockDbContext db,
    EmailAccountService accounts,
    SmtpEmailSender email,
    SettingsService settings,
    ICurrentUser me,
    TimeProvider clock,
    NotificationService notifications,
    ILogger<PurchaseOrderService> logger)
{
    /// <summary>
    /// The exact text the phone should hand to WhatsApp. Composed on the server so the
    /// wording, the totals and the certificate warning are identical to the email — a
    /// supplier who gets both must not see two different orders.
    /// </summary>
    public async Task<ShareTextResult> ShareTextAsync(Guid id, CancellationToken ct)
    {
        var order = await LoadAsync(id, ct);
        var company = await settings.GetAsync(SettingKeys.CompanyName, ct) ?? "SiteStock";

        return new ShareTextResult(
            order.Number,
            // Only a mobile. A landline in a wa.me link opens a chat with nobody, which
            // looks like the app failing rather than like a supplier without WhatsApp.
            WhatsAppNumber(order.Supplier.PhoneNumber),
            PurchaseOrderMessage.WhatsApp(order, company, me.FullName));
    }

    private static readonly Regex IndianMobile = new(@"^[6-9]\d{9}$", RegexOptions.Compiled);

    private static string? WhatsAppNumber(string? phone) =>
        phone is not null && IndianMobile.IsMatch(phone.Trim()) ? phone.Trim() : null;

    public async Task<PagedResult<PurchaseOrderListItem>> ListAsync(
        PurchaseOrderQuery query, CancellationToken ct)
    {
        var page = new PageRequest { Page = query.Page ?? 1, PageSize = query.PageSize ?? 50 };

        var orders = db.PurchaseOrders
            .AsNoTracking()
            .Include(o => o.Site)
            .Include(o => o.Supplier)
            .Include(o => o.Requisition).ThenInclude(r => r!.RequestedBy)
            .Include(o => o.WorkOrder)
            .Include(o => o.Lines).ThenInclude(l => l.Material)
            .Include(o => o.Communications)
            .AsSplitQuery()
            .AsQueryable();

        if (query.SiteId is { } siteId)
        {
            if (!me.CanSeeSite(siteId)) throw AppException.Forbidden("You do not have access to that site.");
            orders = orders.Where(o => o.SiteId == siteId);
        }
        else if (!me.HasAllSites)
        {
            var permitted = me.SiteIds.ToList();
            orders = orders.Where(o => permitted.Contains(o.SiteId));
        }

        if (query.SupplierId is { } supplierId) orders = orders.Where(o => o.SupplierId == supplierId);

        if (!string.IsNullOrWhiteSpace(query.Status)
            && Enum.TryParse<PurchaseOrderStatus>(query.Status, true, out var status))
        {
            orders = orders.Where(o => o.Status == status);
        }

        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var term = $"%{query.Q.Trim()}%";
            // The order number is what a buyer searches by. A supervisor searches by what
            // turned up — so the goods, the request it came from and the contract count too.
            orders = orders.Where(o =>
                EF.Functions.ILike(o.Number, term)
                || EF.Functions.ILike(o.Supplier.Name, term)
                || EF.Functions.ILike(o.Requisition.Number, term)
                || (o.WorkOrder != null && EF.Functions.ILike(o.WorkOrder.Number, term))
                || o.Lines.Any(l => EF.Functions.ILike(l.Material.Name, term)));
        }

        var total = await orders.CountAsync(ct);

        var items = await orders
            .OrderByDescending(o => o.IssuedAt)
            .Skip(page.Skip).Take(page.SafePageSize)
            .ToListAsync(ct);

        // How much of each order has actually turned up. One query for the page rather than
        // one per row: a list of fifty orders should not be fifty round trips.
        var ids = items.Select(o => o.Id).ToList();

        var deliveries = await db.GoodsReceipts.AsNoTracking()
            .Where(g => ids.Contains(g.PurchaseOrderId))
            .GroupBy(g => g.PurchaseOrderId)
            .Select(g => new { OrderId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.OrderId, x => x.Count, ct);

        var received = await db.GoodsReceipts.AsNoTracking()
            .Where(g => ids.Contains(g.PurchaseOrderId) && g.Status == GoodsReceiptStatus.Accepted)
            .SelectMany(g => g.Lines)
            .GroupBy(l => l.PurchaseOrderLineId)
            .Select(g => new { LineId = g.Key, Got = g.Sum(l => l.AcceptedQuantity) })
            .ToDictionaryAsync(x => x.LineId, x => x.Got, ct);

        // A supervisor needs the order to receive against it. He does not need the price.
        var seesPrices = me.Can(Permissions.PricesRead);

        return new PagedResult<PurchaseOrderListItem>(
            items.Select(o => new PurchaseOrderListItem(
                o.Id, o.Number, o.Status.ToString(), o.SiteId, o.Site.Code, o.Site.Name,
                o.SupplierId, o.Supplier.Name, o.IssuedAt, o.ExpectedDelivery,
                seesPrices ? o.GrandTotal : null, o.Lines.Count,
                o.Communications.Any(c => c.Status == CommunicationStatus.Sent
                                          || c.Status == CommunicationStatus.Recorded),
                o.Requisition.Number,
                o.WorkOrderId, o.WorkOrder?.Number,
                deliveries.TryGetValue(o.Id, out var runs) ? runs : 0,
                o.Lines.Count(l =>
                    received.TryGetValue(l.Id, out var got) && got >= l.Quantity),
                Summarise(o.Lines))).ToList(),
            page.SafePage, page.SafePageSize, total);
    }

    /// <summary>
    /// The goods on an order, short enough for one line of a list.
    /// </summary>
    /// <remarks>
    /// Two names and a count rather than all of them: it has to fit beside the order number
    /// on a phone, and two is enough to recognise a load by.
    /// </remarks>
    private static string Summarise(ICollection<PurchaseOrderLine> lines)
    {
        // The same order the printed sheet uses, so the list and the paper read alike.
        var names = lines
            .OrderBy(l => l.Material.Category).ThenBy(l => l.Material.Name)
            .Select(l => l.Material.Name)
            .ToList();

        return names.Count switch
        {
            0 => "nothing listed",
            <= 2 => string.Join(", ", names),
            _ => $"{string.Join(", ", names.Take(2))} +{names.Count - 2} more",
        };
    }

    public async Task<PurchaseOrderDetail> GetAsync(Guid id, CancellationToken ct)
    {
        var order = await LoadAsync(id, ct);
        var delivered = await DeliveredAsync(order, ct);
        var (canApprove, awaitingFrom) = await ApproverAsync(ct);

        return Describe(order, await SummariseWorkOrderAsync(order, ct), delivered,
            await AmendBlockerAsync(order, ct), canApprove, awaitingFrom);
    }

    /// <summary>
    /// What has turned up against this order, newest first, with the papers photographed at
    /// the gate. Drafts are included: a delivery being counted right now is the most useful
    /// thing on the page, and hiding it until somebody presses accept makes the order look
    /// untouched while a lorry is being unloaded.
    /// </summary>
    private async Task<Delivered> DeliveredAsync(PurchaseOrder order, CancellationToken ct)
    {
        var receipts = await db.GoodsReceipts
            .AsNoTracking()
            .Include(g => g.ReceivedBy)
            .Include(g => g.Lines)
            .Where(g => g.PurchaseOrderId == order.Id)
            .OrderByDescending(g => g.ReceivedAt)
            .ToListAsync(ct);

        if (receipts.Count == 0) return new Delivered([], new Dictionary<Guid, decimal>());

        var ids = receipts.Select(g => g.Id).ToList();
        var documents = await db.Documents
            .AsNoTracking()
            .Where(d => d.OwnerType == nameof(GoodsReceipt) && ids.Contains(d.OwnerId))
            .OrderBy(d => d.CreatedAt)
            .ToListAsync(ct);

        // Accepted only: a load still being counted has not entered stock, and showing it
        // against the line would say the order is further along than it is.
        var perLine = receipts
            .Where(g => g.Status == GoodsReceiptStatus.Accepted)
            .SelectMany(g => g.Lines)
            .GroupBy(l => l.PurchaseOrderLineId)
            .ToDictionary(g => g.Key, g => g.Sum(l => l.AcceptedQuantity));

        return new Delivered(receipts.Select(g => new PurchaseOrderReceiptDto(
            g.Id, g.Number, g.Status.ToString(),
            g.ReceivedAt, g.ReceivedBy.FullName,
            g.ChallanNumber, g.VehicleNumber,
            g.Lines.Sum(l => l.ReceivedQuantity),
            g.Lines.Sum(l => l.AcceptedQuantity),
            g.Lines.Any(l => l.ShortQuantity > 0),
            g.Lines.Any(l => l.RejectedQuantity > 0),
            documents.Where(d => d.OwnerId == g.Id)
                .Select(d => new ReceiptFileDto(
                    d.Id, d.Kind.ToString(), d.FileName, d.ContentType, d.SizeBytes, d.Caption))
                .ToList()))
            .ToList(), perLine);
    }

    /// <summary>What has arrived against an order: the deliveries, and the running total per line.</summary>
    private sealed record Delivered(
        IReadOnlyList<PurchaseOrderReceiptDto> Receipts,
        IReadOnlyDictionary<Guid, decimal> AcceptedByLine);

    /// <summary>
    /// The order as it goes to the supplier — letterhead, both GSTINs, where to deliver and
    /// who to ask for. Assembled here rather than in the browser because a document that
    /// leaves the building should not be built from whatever the client happened to cache.
    /// </summary>
    public async Task<PrintablePurchaseOrder> PrintableAsync(Guid id, CancellationToken ct)
    {
        var order = await LoadAsync(id, ct);
        var detail = Describe(order, await SummariseWorkOrderAsync(order, ct),
            await DeliveredAsync(order, ct));

        if (!me.Can(Permissions.PricesRead))
            throw AppException.Forbidden("Only somebody who can see prices can print an order.");

        // The printed sheet is the copy that gets handed across a counter, so producing it is
        // a way of sending. The approver is the exception: they cannot decide on a document
        // they are not allowed to read.
        if (order.SendApproval is Domain.Procurement.SendApproval.Pending
                or Domain.Procurement.SendApproval.ChangesRequested)
        {
            var (canApprove, awaitingFrom) = await ApproverAsync(ct);

            if (!canApprove)
            {
                throw AppException.BadRequest("awaiting_approval",
                    $"{order.Number} has not been approved yet, so the supplier's copy cannot be " +
                    $"produced. It is waiting on {awaitingFrom ?? "an approver"}.");
            }
        }

        // Intra-state splits into CGST and SGST; across a state border it would be IGST. Both
        // suppliers and the company are in Maharashtra, so the split is the honest default —
        // and it is computed here rather than stored, because it is a presentation of the tax
        // total, not a second source of it.
        var half = Math.Round((order.TaxTotal) / 2m, 2);

        var site = order.Site;

        return new PrintablePurchaseOrder(
            detail,
            await settings.GetAsync(SettingKeys.CompanyName, ct) ?? "H. N. Power Solutions Pvt Ltd",
            await settings.GetAsync(SettingKeys.CompanyGstin, ct),
            await settings.GetAsync(SettingKeys.CompanyAddress, ct),
            await settings.GetAsync(SettingKeys.CompanyPhone, ct),
            await settings.GetAsync(SettingKeys.CompanyEmail, ct),
            await settings.GetAsync(SettingKeys.CompanyEmailAlternate, ct),
            site.Name,
            string.Join(", ", new[] { site.AddressLine, site.City, site.Pincode }
                .Where(part => !string.IsNullOrWhiteSpace(part))),
            order.Requisition?.RequestedBy?.FullName,
            order.Requisition?.RequestedBy?.PhoneNumber,
            AmountInWords.Of(order.GrandTotal),
            half,
            order.TaxTotal - half);
    }

    /// <summary>
    /// The contract this order is costed against, with the total committed to it so far —
    /// so the order can be read beside the job it belongs to without leaving the screen.
    /// </summary>
    private async Task<WorkOrderSummary?> SummariseWorkOrderAsync(
        PurchaseOrder order, CancellationToken ct)
    {
        if (order.WorkOrder is not { } workOrder) return null;

        var committed = await db.PurchaseOrders
            .Where(o => o.WorkOrderId == workOrder.Id && o.Status != PurchaseOrderStatus.Cancelled)
            .SumAsync(o => (decimal?)o.GrandTotal, ct) ?? 0m;

        var papers = await db.Documents.AsNoTracking()
            .Where(d => d.OwnerType == nameof(Domain.Contracts.WorkOrder) && d.OwnerId == workOrder.Id)
            .OrderBy(d => d.CreatedAt)
            .Select(d => new ReceiptFileDto(
                d.Id, d.Kind.ToString(), d.FileName, d.ContentType, d.SizeBytes, d.Caption))
            .ToListAsync(ct);

        return new WorkOrderSummary(
            workOrder.Id, workOrder.Number, workOrder.Title, workOrder.ClientName,
            workOrder.Status.ToString(), workOrder.ContractValue, committed,
            workOrder.ContractValue - committed,
            workOrder.ContractValue > 0
                ? (double)Math.Round(committed / workOrder.ContractValue * 100m, 1)
                : 0d,
            papers);
    }

    /// <summary>
    /// Changes what can still be changed: when it is wanted, on what credit, and the note.
    /// </summary>
    /// <remarks>
    /// <para>Allowed right up until the last of the material is in. Orders get changed after
    /// they go out — the buyer rings the supplier and pushes the delivery by five days, or
    /// settles sixty days instead of thirty — and refusing that would only mean the real
    /// terms live on somebody's phone while this screen shows something else.</para>
    ///
    /// <para>What changes once the supplier holds a copy is the <b>ceremony</b>, not the
    /// permission: the change is recorded with a reason, and the order is flagged as needing
    /// to go out again, because their copy no longer matches ours.</para>
    ///
    /// <para>Lines and rates are not editable here at any status. They came through the
    /// approval gate; changing them goes back through it, by amending the requisition.</para>
    /// </remarks>
    public async Task<PurchaseOrderDetail> EditAsync(
        Guid id, EditPurchaseOrderRequest request, CancellationToken ct)
    {
        var order = await LoadAsync(id, ct);

        if (order.CancelledAt is not null)
            throw AppException.BadRequest("order_cancelled", "This order was withdrawn. It cannot be changed.");

        // Everything is in. There is nothing left for a new date or a new term to apply to,
        // and the invoice has already been matched against these figures.
        if (order.Status is PurchaseOrderStatus.Received or PurchaseOrderStatus.Closed)
        {
            throw AppException.BadRequest("already_delivered",
                $"Everything on {order.Number} has been received. Nothing is left for a change " +
                "to apply to — and the bill is checked against these figures.");
        }

        if (request.PaymentTermsDays is < 0 or > 180)
            throw AppException.BadRequest("invalid_terms", "Credit must be between 0 and 180 days.");

        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        if (request.ExpectedDelivery < today)
        {
            throw AppException.BadRequest("delivery_in_past",
                "The delivery date is in the past. A date nobody can meet is not a date.");
        }

        var alreadySent = order.Communications.Count > 0;
        var notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();
        var reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();

        // A change the supplier has to be told about needs a sentence saying what they were
        // told. Before it goes out there is nobody to tell, so nothing is asked for.
        if (alreadySent && reason is null)
        {
            throw AppException.BadRequest("reason_required",
                $"{order.Supplier.Name} already has this order. Say what changed and why, so the " +
                "record shows what they were told.");
        }

        var changes = new List<string>();

        if (order.ExpectedDelivery != request.ExpectedDelivery)
        {
            changes.Add($"Delivery {order.ExpectedDelivery:d MMM} → {request.ExpectedDelivery:d MMM}");
            order.ExpectedDelivery = request.ExpectedDelivery;
        }

        if (order.PaymentTermsDays != request.PaymentTermsDays)
        {
            changes.Add($"Credit {order.PaymentTermsDays} → {request.PaymentTermsDays} days");
            order.PaymentTermsDays = request.PaymentTermsDays;
        }

        if (order.Notes != notes)
        {
            changes.Add(notes is null ? "Note removed" : "Note changed");
            order.Notes = notes;
        }

        // Nothing actually moved. Recording "changed nothing" would fill the history with
        // rows that make a real change harder to find.
        if (changes.Count == 0) return await GetAsync(id, ct);

        db.PurchaseOrderChanges.Add(new PurchaseOrderChange
        {
            PurchaseOrderId = order.Id,
            Summary = string.Join(" · ", changes),
            Reason = reason,
            ChangedAt = clock.GetUtcNow(),
            ChangedById = me.Id,
            AfterSending = alreadySent,
        });

        // A date or a credit term is part of the document that was approved, so moving one
        // sends it back round — the same rule the rates follow.
        ReopenApproval(order, changes);

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    /// <summary>
    /// New rates on an order, from the buyer, after the owner approved the old ones.
    /// </summary>
    /// <remarks>
    /// <para>Rates move. The supplier rings back and says steel is up four rupees, or the
    /// buyer gets a better discount than the one he quoted. Sending him back through the
    /// requisition — cancel the order, re-price, get it approved again, raise a new order —
    /// for a change of a few hundred rupees is how a system ends up bypassed.</para>
    ///
    /// <para>So it is allowed, and it is loud. Every change is recorded with a reason and the
    /// old and new totals, and if the order gets dearer the owner is told, because the figure
    /// they approved is no longer the figure being spent.</para>
    ///
    /// <para>It stops the moment anything has been received: stock taken in was valued at
    /// the ordered rate, and rewriting the rate afterwards would silently restate what is on
    /// the ground.</para>
    /// </remarks>
    public async Task<PurchaseOrderDetail> RepriceAsync(
        Guid id, RepriceOrderRequest request, CancellationToken ct)
    {
        var order = await LoadAsync(id, ct);

        if (order.CancelledAt is not null)
            throw AppException.BadRequest("order_cancelled", "This order was withdrawn. Its rates cannot be changed.");

        if (order.Status is not (PurchaseOrderStatus.Issued or PurchaseOrderStatus.Sent))
        {
            throw AppException.BadRequest("already_receiving",
                $"Material has already been taken in against {order.Number}. It was valued at " +
                "these rates, so they cannot be rewritten now.");
        }

        if (string.IsNullOrWhiteSpace(request.Reason))
        {
            throw AppException.BadRequest("reason_required",
                "Say why the rates changed. The owner approved the old ones.");
        }

        var byId = order.Lines.ToDictionary(l => l.Id);
        var wasTotal = order.GrandTotal;
        var changed = new List<string>();

        foreach (var line in request.Lines)
        {
            if (!byId.TryGetValue(line.LineId, out var existing))
                throw AppException.BadRequest("unknown_line", "A line does not belong to this order.");

            if (line.TaxPercent is < 0 or > 100)
                throw AppException.BadRequest("invalid_tax", "GST must be between 0 and 100 percent.");

            if (line.ListRate is <= 0)
                throw AppException.BadRequest("invalid_list_rate", "A list price must be more than zero.");

            if (line.DiscountPercent is < 0 or >= 100)
                throw AppException.BadRequest("invalid_discount", "A discount must be between 0 and 100 percent.");

            // Same rule as pricing: with a list price and a discount the rate is derived, so
            // the three figures printed side by side can never disagree.
            var rate = line.ListRate is { } list
                ? Math.Round(list * (1m - (line.DiscountPercent ?? 0m) / 100m), 4)
                : line.UnitRate;

            if (rate <= 0)
                throw AppException.BadRequest("invalid_rate", $"The rate for {existing.Material.Name} must be more than zero.");

            if (existing.UnitRate != rate)
            {
                changed.Add($"{existing.Material.Name} {Money(existing.UnitRate)} → {Money(rate)}");
            }

            existing.UnitRate = rate;
            existing.TaxPercent = line.TaxPercent;
            existing.ListRate = line.ListRate;
            existing.DiscountPercent = line.ListRate is null ? null : line.DiscountPercent;
            existing.ProductCode = Blank(line.ProductCode);
            existing.Make = Blank(line.Make);
            existing.LineTotal = Math.Round(existing.Quantity * rate, 2);
            existing.TaxAmount = Math.Round(existing.LineTotal * existing.TaxPercent / 100m, 2);
        }

        order.SubTotal = order.Lines.Sum(l => l.LineTotal);
        order.TaxTotal = order.Lines.Sum(l => l.TaxAmount);
        order.GrandTotal = order.SubTotal + order.TaxTotal;

        if (changed.Count == 0 && order.GrandTotal == wasTotal)
            return await GetAsync(id, ct);

        ReopenApproval(order, changed);

        var alreadySent = order.Communications.Count > 0;

        db.PurchaseOrderChanges.Add(new PurchaseOrderChange
        {
            PurchaseOrderId = order.Id,
            Summary = $"Rates changed · order total {Money(wasTotal)} → {Money(order.GrandTotal)}"
                      + (changed.Count > 0 ? $" ({string.Join(", ", changed)})" : string.Empty),
            Reason = request.Reason.Trim(),
            ChangedAt = clock.GetUtcNow(),
            ChangedById = me.Id,
            AfterSending = alreadySent,
        });

        // Dearer than what was approved: the owner is told without being asked to re-approve,
        // because the material is often already on its way and a silent increase is the thing
        // nobody forgives.
        //
        // Raised before the save, not after: the notification service only adds rows to the
        // context, so a save that has already happened leaves the alert sitting unsent — and
        // this way the change and the alert commit together or not at all.
        if (order.GrandTotal > wasTotal)
        {
            await notifications.RaiseForPermissionAsync(
                Permissions.PurchasesApprove, order.SiteId,
                NotificationKind.PurchaseOrderRepriced,
                $"{order.Number} is dearer than approved",
                $"{Money(wasTotal)} → {Money(order.GrandTotal)} · {me.FullName} · {request.Reason.Trim()}",
                $"/purchase-orders/{order.Id}",
                NotificationUrgency.Normal, alsoEmail: false, ct: ct);
        }

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    private static string Money(decimal value) => $"\u20b9{value:N2}";

    private static string? Blank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// Lets the order go to the supplier.
    /// </summary>
    /// <remarks>
    /// <para>The owner approved a requisition — a list and a total. What leaves the building
    /// is a document carrying a delivery date, credit terms, a note and rates the buyer may
    /// have renegotiated since. This is the gate on that document, and it exists only when
    /// the company has asked for it.</para>
    /// </remarks>
    public async Task<PurchaseOrderDetail> ApproveSendAsync(
        Guid id, SendApprovalDecision decision, bool approved, CancellationToken ct)
    {
        var order = await LoadAsync(id, ct);
        var (canApprove, _) = await ApproverAsync(ct);

        if (!canApprove)
        {
            throw AppException.Forbidden(
                "You are not named as somebody who approves orders before they are sent.");
        }

        if (order.CancelledAt is not null)
            throw AppException.BadRequest("order_cancelled", "This order was withdrawn.");

        if (order.SendApproval == Domain.Procurement.SendApproval.NotRequired)
        {
            throw AppException.BadRequest("not_gated",
                $"{order.Number} does not need approving before it is sent.");
        }

        if (order.Communications.Count > 0)
        {
            throw AppException.BadRequest("already_sent",
                $"{order.Number} has already gone to {order.Supplier.Name}.");
        }

        var note = string.IsNullOrWhiteSpace(decision.Note) ? null : decision.Note.Trim();

        if (!approved && note is null)
        {
            throw AppException.BadRequest("reason_required",
                "Say what needs changing. Sending it back without a reason only costs a phone call.");
        }

        order.SendApproval = approved
            ? Domain.Procurement.SendApproval.Approved
            : Domain.Procurement.SendApproval.ChangesRequested;
        order.SendApprovalDecidedAt = clock.GetUtcNow();
        order.SendApprovalDecidedById = me.Id;
        order.SendApprovalNote = note;

        db.PurchaseOrderChanges.Add(new PurchaseOrderChange
        {
            PurchaseOrderId = order.Id,
            Summary = approved ? "Approved to send" : "Sent back to the buyer",
            Reason = note,
            ChangedAt = clock.GetUtcNow(),
            ChangedById = me.Id,
            AfterSending = false,
        });

        // The buyer is the one waiting on this, and he is the person who raised it.
        notifications.Raise(
            [order.IssuedById],
            approved ? NotificationKind.RequisitionApproved : NotificationKind.RequisitionSentBack,
            approved
                ? $"{order.Number} is approved — send it to {order.Supplier.Name}"
                : $"{order.Number} came back for a change",
            note ?? $"{me.FullName} · {Money(order.GrandTotal)}",
            $"/purchase-orders/{order.Id}",
            order.SiteId,
            approved ? NotificationUrgency.Normal : NotificationUrgency.Urgent);

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    /// <summary>
    /// An approved order that has since been changed goes back for approval.
    /// </summary>
    /// <remarks>
    /// What was approved was a document — this date, this credit, these rates. Change any of
    /// them and the approval is of something that no longer exists. Silently keeping it would
    /// make the gate worse than useless: it would look like a control while being none.
    /// </remarks>
    private void ReopenApproval(PurchaseOrder order, IReadOnlyList<string> changes)
    {
        if (order.SendApproval != Domain.Procurement.SendApproval.Approved) return;
        if (changes.Count == 0) return;

        order.SendApproval = Domain.Procurement.SendApproval.Pending;
        order.SendApprovalDecidedAt = null;
        order.SendApprovalDecidedById = null;
        order.SendApprovalNote = null;

        db.PurchaseOrderChanges.Add(new PurchaseOrderChange
        {
            PurchaseOrderId = order.Id,
            Summary = "Approval to send withdrawn — the order changed after it was approved",
            ChangedAt = clock.GetUtcNow(),
            ChangedById = me.Id,
            AfterSending = false,
        });
    }

    /// <summary>Refuses to let an ungated order out. Called by both ways of sending.</summary>
    private static void EnsureApprovedToSend(PurchaseOrder order, string? awaitingFrom)
    {
        switch (order.SendApproval)
        {
            case Domain.Procurement.SendApproval.Pending:
                throw AppException.BadRequest("awaiting_approval",
                    $"{order.Number} has to be approved before it goes to the supplier. " +
                    $"It is waiting on {awaitingFrom ?? "an approver"}.");

            case Domain.Procurement.SendApproval.ChangesRequested:
                throw AppException.BadRequest("changes_requested",
                    $"{order.Number} was sent back: \"{order.SendApprovalNote}\". " +
                    "Make the change, and it goes back for approval.");
        }
    }

    /// <summary>
    /// Actually sends the order, by email.
    ///
    /// <para>It goes through the signed-in person's own mailbox if they have set one up and
    /// the company's shared one otherwise — so the supplier gets it from a buyer they know,
    /// and replies land in that person's inbox.</para>
    ///
    /// <para>This is the only path that transmits anything. Everything a person does with
    /// their own hands — a phone call, a printed copy across the counter, WhatsApp off their
    /// own phone — goes through <see cref="RecordSentAsync"/>. Keeping the two apart is the
    /// point: one endpoint that both sends and pretends to send produces a log where "sent"
    /// means two different things, and then nobody chases anything.</para>
    /// </summary>
    public async Task<PurchaseOrderDetail> SendAsync(
        Guid id, SendPurchaseOrderRequest request, CancellationToken ct)
    {
        var order = await LoadAsync(id, ct);

        if (order.Status is PurchaseOrderStatus.Cancelled)
            throw AppException.BadRequest("order_cancelled", "This order has been cancelled.");

        EnsureApprovedToSend(order, (await ApproverAsync(ct)).AwaitingFrom);

        if (!Enum.TryParse<CommunicationChannel>(request.Channel, true, out var channel))
            throw AppException.BadRequest("unknown_channel", $"There is no channel called '{request.Channel}'.");

        if (channel != CommunicationChannel.Email)
        {
            throw AppException.BadRequest("not_sendable",
                "Only email is sent from here. If you sent it yourself — on the phone, by hand, "
                + "or from your own account — mark it as sent instead.");
        }

        if (string.IsNullOrWhiteSpace(request.Recipient))
            throw AppException.BadRequest("recipient_required", "Say who it went to.");

        var now = clock.GetUtcNow();

        // Recorded, not Sent, until the mail actually leaves. A log that says "sent" when
        // nothing went is how a supplier ends up never hearing about an order.
        var status = CommunicationStatus.Recorded;
        string? failure = null;

        var account = await accounts.ResolveAsync(me.Id, ct);

        if (account is null)
        {
            failure = "No mailbox is set up, so nothing was actually sent. Add your own " +
                      "under My email, or ask an administrator to configure the company " +
                      "mailbox in Settings. The dispatch is recorded so nothing is lost.";
        }
        else
        {
            var company = await settings.GetAsync(SettingKeys.CompanyName, ct) ?? "SiteStock";
            var gstin = await settings.GetAsync(SettingKeys.CompanyGstin, ct);

            var outcome = await email.SendAsync(account, new EmailMessage(
                request.Recipient.Trim(),
                order.Supplier.ContactPerson ?? order.Supplier.Name,
                PurchaseOrderMessage.Subject(order, company),
                PurchaseOrderMessage.Html(order, company, gstin, me.FullName),
                PurchaseOrderMessage.Plain(order, company, me.FullName)), ct);

            status = outcome.Sent ? CommunicationStatus.Sent : CommunicationStatus.Failed;
            failure = outcome.Sent ? null : outcome.Message;
        }

        // Through the DbSet: the order is already tracked, and our keys are assigned in the
        // constructor, so attaching via the navigation alone would be read as an update.
        var entry = new PurchaseOrderCommunication
        {
            PurchaseOrderId = order.Id,
            Channel = channel,
            Status = status,
            Recipient = request.Recipient.Trim(),
            SentAt = now,
            SentById = me.Id,
            Notes = request.Notes?.Trim(),
            FailureReason = failure,
        };

        db.PurchaseOrderCommunications.Add(entry);

        // A failed send still leaves the order as "issued" — saying it was sent when the
        // mail bounced is how a supplier ends up never hearing about an order.
        if (order.Status == PurchaseOrderStatus.Issued && status != CommunicationStatus.Failed)
            order.Status = PurchaseOrderStatus.Sent;

        await db.SaveChangesAsync(ct);

        logger.LogInformation("Purchase order {Number} to {Recipient} via {Channel}: {Status}",
            order.Number, request.Recipient, channel, status);

        return await GetAsync(id, ct);
    }

    /// <summary>
    /// "I sent this myself." Nothing is transmitted — the buyer already did the sending, by
    /// hand, on the phone, or out of their own mailbox because ours would not go. This is the
    /// note that it happened, so a late delivery can be chased against a record rather than
    /// against somebody's memory.
    /// </summary>
    public async Task<PurchaseOrderDetail> RecordSentAsync(
        Guid id, RecordSentRequest request, CancellationToken ct)
    {
        var order = await LoadAsync(id, ct);

        if (order.Status is PurchaseOrderStatus.Cancelled)
            throw AppException.BadRequest("order_cancelled", "This order has been cancelled.");

        EnsureApprovedToSend(order, (await ApproverAsync(ct)).AwaitingFrom);

        if (!Enum.TryParse<CommunicationChannel>(request.Channel, true, out var channel))
            throw AppException.BadRequest("unknown_channel", $"There is no channel called '{request.Channel}'.");

        if (string.IsNullOrWhiteSpace(request.Recipient))
            throw AppException.BadRequest("recipient_required", "Say who it went to.");

        var notes = request.Notes?.Trim();

        // "Other" names no channel at all, so on its own it records nothing anybody can act on.
        if (channel == CommunicationChannel.Other && string.IsNullOrWhiteSpace(notes))
            throw AppException.BadRequest("notes_required", "Say how it went, since it was not one of the usual ways.");

        var now = clock.GetUtcNow();

        db.PurchaseOrderCommunications.Add(new PurchaseOrderCommunication
        {
            PurchaseOrderId = order.Id,
            Channel = channel,
            // Sent, not Recorded: a person is asserting that it went. Recorded is reserved for
            // the case where the app tried and had nothing to send with.
            Status = CommunicationStatus.Sent,
            Recipient = request.Recipient.Trim(),
            SentAt = now,
            SentById = me.Id,
            Notes = notes,
        });

        if (order.Status == PurchaseOrderStatus.Issued)
            order.Status = PurchaseOrderStatus.Sent;

        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Purchase order {Number} marked sent by hand to {Recipient} via {Channel} by {Actor}",
            order.Number, request.Recipient, channel, me.FullName);

        return await GetAsync(id, ct);
    }

    private async Task<PurchaseOrder> LoadAsync(Guid id, CancellationToken ct)
    {
        var order = await db.PurchaseOrders
            .Include(o => o.Site)
            .Include(o => o.Supplier)
            .Include(o => o.Requisition).ThenInclude(r => r!.RequestedBy)
            .Include(o => o.WorkOrder)
            .Include(o => o.IssuedBy)
            .Include(o => o.CancelledBy)
            .Include(o => o.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
            .Include(o => o.Communications).ThenInclude(c => c.SentBy)
            .Include(o => o.Changes).ThenInclude(c => c.ChangedBy)
            .Include(o => o.SendApprovalDecidedBy)
            .FirstOrDefaultAsync(o => o.Id == id, ct)
            ?? throw AppException.NotFound("That purchase order");

        if (!me.CanSeeSite(order.SiteId))
            throw AppException.Forbidden("This order belongs to a site you do not have access to.");

        return order;
    }

    private PurchaseOrderDetail Describe(
        PurchaseOrder o, WorkOrderSummary? workOrder, Delivered delivered,
        string? amendBlockedReason = null,
        bool canApproveSend = false, string? awaitingFrom = null)
    {
        var seesPrices = me.Can(Permissions.PricesRead);
        return Describe(o, workOrder, seesPrices, delivered, amendBlockedReason,
            canApproveSend, awaitingFrom);
    }

    /// <summary>
    /// Who may let this order go to the supplier, and whether the person reading is one of
    /// them.
    /// </summary>
    /// <remarks>
    /// Named people, from the settings screen. When nobody is named it falls to whoever
    /// approves spending — a gate with no gatekeeper would simply stop every order, and the
    /// buyer would go back to the phone.
    /// </remarks>
    private async Task<(bool CanApprove, string? AwaitingFrom)> ApproverAsync(CancellationToken ct)
    {
        var raw = await settings.GetAsync(SettingKeys.SendApprovers, ct) ?? string.Empty;

        var ids = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(part => Guid.TryParse(part, out var id) ? id : (Guid?)null)
            .Where(id => id is not null)
            .Select(id => id!.Value)
            .ToList();

        if (ids.Count == 0)
            return (me.Can(Permissions.PurchasesApprove), "whoever approves spending");

        var names = await db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id) && u.IsActive)
            .Select(u => u.FullName)
            .ToListAsync(ct);

        return (ids.Contains(me.Id), names.Count == 0 ? "nobody — set an approver" : string.Join(" or ", names));
    }

    /// <summary>
    /// Why the materials on this order cannot be changed, or null when they can.
    /// </summary>
    /// <remarks>
    /// Its own query rather than an <c>Include</c>: purchase order → requisition → purchase
    /// orders is a cycle, and EF refuses those on a no-tracking query — which took the whole
    /// order list down with a 500 rather than just this field.
    /// </remarks>
    private async Task<string?> AmendBlockerAsync(PurchaseOrder order, CancellationToken ct)
    {
        var siblings = await db.PurchaseOrders.AsNoTracking()
            .Where(o => o.RequisitionId == order.RequisitionId)
            .Select(o => o.Status)
            .ToListAsync(ct);

        return Requisitions.Amendability.Blocker(order.Requisition.Status, siblings);
    }

    private static PurchaseOrderDetail Describe(
        PurchaseOrder o, WorkOrderSummary? workOrder, bool seesPrices,
        Delivered delivered, string? amendBlockedReason = null,
        bool canApproveSend = false, string? awaitingFrom = null) => new(
        o.Id, o.Number, o.Status.ToString(),
        o.RequisitionId, o.Requisition.Number,
        o.SiteId, o.Site.Code, o.Site.Name,
        o.SupplierId, o.Supplier.Name, o.Supplier.Gstin,
        o.Supplier.ContactPerson, o.Supplier.PhoneNumber, o.Supplier.Email,
        o.IssuedAt, o.IssuedBy.FullName, o.ExpectedDelivery,
        o.PaymentTermsDays, o.DeliveryInstructions, o.Notes,
        seesPrices ? o.SubTotal : null, seesPrices ? o.TaxTotal : null,
        seesPrices ? o.GrandTotal : null,
        o.Lines
            .OrderBy(l => l.Material.Category).ThenBy(l => l.Material.Name)
            .Select(l => new PurchaseOrderLineDto(
                l.Id, l.MaterialId, l.Material.Code, l.Material.Name, l.Material.Specification,
                l.Material.Unit.Code, l.Material.Unit.DecimalPlaces, l.Material.RequiresCertificate,
                l.Material.HsnCode,
                l.Quantity,
                delivered.AcceptedByLine.TryGetValue(l.Id, out var got) ? got : 0m,
                l.ProductCode, l.Make,
                seesPrices ? l.ListRate : null, seesPrices ? l.DiscountPercent : null,
                seesPrices ? l.UnitRate : null, seesPrices ? l.TaxPercent : null,
                seesPrices ? l.LineTotal : null, seesPrices ? l.TaxAmount : null, l.Notes))
            .ToList(),
        o.Communications
            .OrderByDescending(c => c.SentAt)
            .Select(c => new CommunicationDto(
                c.Id, c.Channel.ToString(), c.Status.ToString(), c.Recipient,
                c.SentAt, c.SentBy.FullName, c.Notes, c.FailureReason))
            .ToList(),
        workOrder,
        o.CancelledAt, o.CancellationReason, o.CancelledBy?.FullName,
        delivered.Receipts,
        o.Changes
            .OrderByDescending(c => c.ChangedAt)
            .Select(c => new OrderChangeDto(
                c.Id, c.Summary, c.Reason, c.ChangedAt, c.ChangedBy.FullName, c.AfterSending))
            .ToList(),
        // Their copy is stale when something moved after the last time it went out. Derived
        // rather than stored: a flag somebody has to remember to clear is a flag that lies.
        o.Communications.Count > 0
            && o.Changes.Any(c => c.ChangedAt > o.Communications.Max(m => m.SentAt)),
        o.SendApproval.ToString(),
        o.SendApprovalDecidedAt,
        o.SendApprovalDecidedBy?.FullName,
        o.SendApprovalNote,
        canApproveSend,
        o.SendApproval == Domain.Procurement.SendApproval.Pending ? awaitingFrom : null,
        // The same rule the requisition screen enforces, answered here so the order's own
        // screen can offer the amendment or say why it cannot.
        amendBlockedReason);
}
