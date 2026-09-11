using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Contracts;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.WorkOrders;

/// <param name="ContractValue">Total basic value — before discount and before GST.</param>
public record SaveWorkOrderRequest(
    string Number, string Title, string ClientName, string? ClientReference,
    Guid SiteId, decimal ContractValue, DateOnly? StartDate, DateOnly? EndDate,
    string? ScopeSummary, string? Notes,
    /// <summary>What the client asked for, item by item. Null leaves the existing list alone.</summary>
    IReadOnlyList<SaveWorkOrderLineRequest>? Lines = null,
    /// <summary>The date printed on their order, which is not the day we typed it in.</summary>
    DateOnly? OrderedOn = null,
    string? ProjectName = null,
    string? ClientGstin = null,
    string? ClientAddress = null,
    string? BillingAddress = null,
    string? ClientContactName = null,
    string? ClientContactPhone = null,
    /// <summary>Their credit terms, in their own words.</summary>
    string? PaymentTerms = null,
    string? AmendmentVersion = null,
    decimal DiscountAmount = 0m,
    decimal CgstAmount = 0m,
    decimal SgstAmount = 0m,
    decimal IgstAmount = 0m);

/// <param name="Rate">What the client pays per unit — the sale rate, not what we buy at.</param>
public record SaveWorkOrderLineRequest(
    Guid MaterialId, decimal Quantity, decimal? Rate, string? Description,
    /// <summary>The client's own item number, as printed on their sheet.</summary>
    string? ClientItemCode = null,
    /// <summary>The heading it sits under on their annexure, e.g. ELECTRICAL PANELS.</summary>
    string? Section = null,
    string? SacHsnCode = null,
    decimal? TaxPercent = null);

/// <summary>
/// One purchase order's share of a single contract item.
/// </summary>
/// <remarks>
/// A contract line is rarely filled by one order — 200 switches arrive as three orders over
/// two months. The total answers "how many", and only the breakdown answers "on which order,
/// from whom, and has it landed" without leaving the page to find out.
/// </remarks>
public record CoverageOrderDto(
    Guid OrderId, string Number, string SupplierName, string Status,
    DateTimeOffset IssuedAt, decimal Quantity, decimal ReceivedQuantity, decimal Value);

/// <summary>
/// One item the client asked for, beside what has actually been bought against it.
/// </summary>
/// <param name="OnWorkOrder">False when this material was purchased but never asked for.</param>
/// <param name="Tone">ok · watch (80% or more) · bad (past the quantity, or never asked for).</param>
public record WorkOrderCoverageRow(
    Guid MaterialId, string MaterialCode, string MaterialName, string UnitCode,
    int UnitDecimalPlaces, string? ClientItemCode, string? Description,
    /// <summary>Their annexure heading, so a long sheet can be read in blocks.</summary>
    string? Section, string? SacHsnCode, decimal? TaxPercent,
    decimal WorkOrderQuantity, decimal? SaleRate, decimal SaleValue,
    decimal OrderedQuantity, decimal ReceivedQuantity, decimal PendingQuantity,
    double PercentOrdered, decimal OrderedValue,
    bool OnWorkOrder, string Tone,
    /// <summary>Every order that bought this item, newest first.</summary>
    IReadOnlyList<CoverageOrderDto> Orders);

public record LinkedOrderDto(
    Guid Id, string Number, string SupplierName, string Status,
    DateTimeOffset IssuedAt, DateOnly ExpectedDelivery, decimal GrandTotal,
    /// <summary>Value actually taken in at the gate, at ordered rates.</summary>
    decimal ReceivedValue);

/// <summary>
/// Just enough of a contract to choose it from a list.
/// </summary>
/// <remarks>
/// A supervisor raising a request knows which job the material is for, and is the person
/// best placed to say so — but he is not shown what the client is paying, here or anywhere
/// else. So this carries the number, the job and the client, and no money at all. The full
/// list stays behind <c>workorders.read</c>.
/// </remarks>
public record WorkOrderPick(Guid Id, string Number, string Title, string ClientName, Guid SiteId);

public record WorkOrderListItem(
    Guid Id, string Number, string Title, string ClientName, string Status,
    Guid SiteId, string SiteName, decimal ContractValue,
    DateOnly? StartDate, DateOnly? EndDate,
    decimal Committed, decimal Remaining, double PercentCommitted, int OrderCount,
    /// <summary>
    /// How many files of the client's own paperwork are held against this contract. A
    /// contract with none is one nobody can check a purchase order against.
    /// </summary>
    int DocumentCount);

public record WorkOrderDetail(
    Guid Id, string Number, string Title, string ClientName, string? ClientReference,
    string Status, Guid SiteId, string SiteName,
    decimal ContractValue, DateOnly? StartDate, DateOnly? EndDate,
    string? ScopeSummary, string? Notes,
    DateOnly? OrderedOn, string? ProjectName, string? ClientGstin, string? ClientAddress,
    string? BillingAddress, string? ClientContactName, string? ClientContactPhone,
    string? PaymentTerms, string? AmendmentVersion,
    decimal DiscountAmount, decimal CgstAmount, decimal SgstAmount, decimal IgstAmount,
    /// <summary>Basic value less discount.</summary>
    decimal NetValue,
    /// <summary>Their "Total WO Value" — net value with tax on top.</summary>
    decimal TotalOrderValue,
    decimal Committed, decimal Received, decimal Remaining, double PercentCommitted,
    /// <summary>Contract value less what has been committed — the money still on the table.</summary>
    decimal GrossMargin,
    double GrossMarginPercent,
    IReadOnlyList<LinkedOrderDto> PurchaseOrders,
    /// <summary>The client's own paperwork for this contract, oldest first.</summary>
    IReadOnlyList<WorkOrderFileDto> Documents,
    /// <summary>What the client asked for, against what has been bought. Empty until typed in.</summary>
    IReadOnlyList<WorkOrderCoverageRow> Coverage,
    /// <summary>
    /// The client's own total for the items listed, so a typed-in sheet can be checked
    /// against the contract value somebody entered by hand.
    /// </summary>
    decimal ItemisedValue,
    bool CanManage);

/// <param name="Kind">ClientWorkOrder, WorkOrderAmendment or Other.</param>
public record WorkOrderFileDto(
    Guid Id, string Kind, string FileName, string ContentType, long SizeBytes,
    string? Caption, DateTimeOffset UploadedAt, string UploadedByName);

/// <summary>
/// Work orders, and what they are costing.
///
/// The whole point of this feature is one screen showing the contract value beside the
/// purchase orders raised against it. Everything else here exists to make that screen honest.
/// </summary>
public sealed class WorkOrderService(SiteStockDbContext db, ICurrentUser me)
{
    public async Task<IReadOnlyList<WorkOrderListItem>> ListAsync(
        Guid? siteId, string? status, string? q, CancellationToken ct)
    {
        var workOrders = db.WorkOrders.AsNoTracking().Include(w => w.Site).AsQueryable();

        if (siteId is { } id)
        {
            if (!me.CanSeeSite(id)) throw AppException.Forbidden("You do not have access to that site.");
            workOrders = workOrders.Where(w => w.SiteId == id);
        }
        else if (!me.HasAllSites)
        {
            var permitted = me.SiteIds.ToList();
            workOrders = workOrders.Where(w => permitted.Contains(w.SiteId));
        }

        if (!string.IsNullOrWhiteSpace(status)
            && Enum.TryParse<WorkOrderStatus>(status, true, out var parsed))
        {
            workOrders = workOrders.Where(w => w.Status == parsed);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = $"%{q.Trim()}%";
            workOrders = workOrders.Where(w =>
                EF.Functions.ILike(w.Number, term) ||
                EF.Functions.ILike(w.Title, term) ||
                EF.Functions.ILike(w.ClientName, term));
        }

        var items = await workOrders.OrderBy(w => w.Status).ThenBy(w => w.Number).ToListAsync(ct);
        var ids = items.Select(w => w.Id).ToList();

        var committed = await CommittedAsync(ids, ct);

        var files = await db.Documents.AsNoTracking()
            .Where(d => d.OwnerType == nameof(WorkOrder) && ids.Contains(d.OwnerId))
            .GroupBy(d => d.OwnerId)
            .Select(g => new { OwnerId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.OwnerId, x => x.Count, ct);

        return items.Select(w =>
        {
            committed.TryGetValue(w.Id, out var spend);
            files.TryGetValue(w.Id, out var fileCount);

            return new WorkOrderListItem(
                w.Id, w.Number, w.Title, w.ClientName, w.Status.ToString(),
                w.SiteId, w.Site.Name, w.ContractValue, w.StartDate, w.EndDate,
                spend.Value, w.ContractValue - spend.Value,
                Percent(spend.Value, w.ContractValue), spend.Count, fileCount);
        }).ToList();
    }

    /// <summary>Open contracts this person may raise a request against.</summary>
    public async Task<IReadOnlyList<WorkOrderPick>> PickableAsync(
        Guid? siteId, CancellationToken ct)
    {
        var jobs = db.WorkOrders.AsNoTracking()
            .Where(w => w.Status == WorkOrderStatus.Active || w.Status == WorkOrderStatus.OnHold);

        if (siteId is { } only)
        {
            if (!me.CanSeeSite(only)) throw AppException.Forbidden("You do not have access to that site.");
            jobs = jobs.Where(w => w.SiteId == only);
        }
        else if (!me.HasAllSites)
        {
            var permitted = me.SiteIds.ToList();
            jobs = jobs.Where(w => permitted.Contains(w.SiteId));
        }

        return await jobs
            .OrderBy(w => w.Number)
            .Select(w => new WorkOrderPick(w.Id, w.Number, w.Title, w.ClientName, w.SiteId))
            .ToListAsync(ct);
    }

    public async Task<WorkOrderDetail> GetAsync(Guid id, CancellationToken ct)
    {
        var workOrder = await LoadAsync(id, ct);

        var orders = await db.PurchaseOrders.AsNoTracking()
            .Include(o => o.Supplier)
            .Where(o => o.WorkOrderId == id && o.Status != PurchaseOrderStatus.Cancelled)
            .OrderByDescending(o => o.IssuedAt)
            .ToListAsync(ct);

        // What has actually been taken in at the gate, valued at the ordered rate. The gap
        // between this and committed is money promised but not yet on the ground.
        var received = await db.GoodsReceiptLines.AsNoTracking()
            .Where(l => l.GoodsReceipt.Status == Domain.Receiving.GoodsReceiptStatus.Accepted
                        && l.PurchaseOrderLine.PurchaseOrder.WorkOrderId == id)
            .SumAsync(l => (decimal?)(l.AcceptedQuantity * l.PurchaseOrderLine.UnitRate), ct) ?? 0m;

        var receivedByOrder = await db.GoodsReceiptLines.AsNoTracking()
            .Where(l => l.GoodsReceipt.Status == Domain.Receiving.GoodsReceiptStatus.Accepted
                        && l.PurchaseOrderLine.PurchaseOrder.WorkOrderId == id)
            .GroupBy(l => l.PurchaseOrderLine.PurchaseOrderId)
            .Select(g => new { OrderId = g.Key, Value = g.Sum(l => l.AcceptedQuantity * l.PurchaseOrderLine.UnitRate) })
            .ToDictionaryAsync(x => x.OrderId, x => x.Value, ct);

        var committed = orders.Sum(o => o.GrandTotal);
        var margin = workOrder.ContractValue - committed;

        var documents = await db.Documents.AsNoTracking()
            .Include(d => d.UploadedBy)
            .Where(d => d.OwnerType == nameof(WorkOrder) && d.OwnerId == workOrder.Id)
            .OrderBy(d => d.CreatedAt)
            .ToListAsync(ct);

        return new WorkOrderDetail(
            workOrder.Id, workOrder.Number, workOrder.Title, workOrder.ClientName,
            workOrder.ClientReference, workOrder.Status.ToString(),
            workOrder.SiteId, workOrder.Site.Name,
            workOrder.ContractValue, workOrder.StartDate, workOrder.EndDate,
            workOrder.ScopeSummary, workOrder.Notes,
            workOrder.OrderedOn, workOrder.ProjectName, workOrder.ClientGstin,
            workOrder.ClientAddress, workOrder.BillingAddress,
            workOrder.ClientContactName, workOrder.ClientContactPhone,
            workOrder.PaymentTerms, workOrder.AmendmentVersion,
            workOrder.DiscountAmount, workOrder.CgstAmount, workOrder.SgstAmount,
            workOrder.IgstAmount, workOrder.NetValue, workOrder.TotalOrderValue,
            committed, Math.Round(received, 2), workOrder.ContractValue - committed,
            Percent(committed, workOrder.ContractValue),
            margin,
            workOrder.ContractValue > 0
                ? (double)Math.Round(margin / workOrder.ContractValue * 100m, 1)
                : 0d,
            orders.Select(o =>
            {
                receivedByOrder.TryGetValue(o.Id, out var value);
                return new LinkedOrderDto(
                    o.Id, o.Number, o.Supplier.Name, o.Status.ToString(),
                    o.IssuedAt, o.ExpectedDelivery, o.GrandTotal, Math.Round(value, 2));
            }).ToList(),
            documents.Select(d => new WorkOrderFileDto(
                d.Id, d.Kind.ToString(), d.FileName, d.ContentType, d.SizeBytes,
                d.Caption, d.CreatedAt, d.UploadedBy.FullName)).ToList(),
            await CoverageAsync(workOrder, ct),
            Math.Round(workOrder.Lines.Sum(l => l.Quantity * (l.Rate ?? 0m)), 2),
            me.Can(Permissions.WorkOrdersManage));
    }

    /// <summary>
    /// Refuses a document id that is not this contract's, so a guessed id cannot delete
    /// somebody else's challan through a route that only checks the work-order permission.
    /// </summary>
    public async Task EnsureDocumentBelongsAsync(Guid workOrderId, Guid documentId, CancellationToken ct)
    {
        await LoadAsync(workOrderId, ct);

        var belongs = await db.Documents.AsNoTracking().AnyAsync(
            d => d.Id == documentId
                 && d.OwnerType == nameof(WorkOrder)
                 && d.OwnerId == workOrderId, ct);

        if (!belongs) throw AppException.NotFound("That document on this work order");
    }

    public async Task<WorkOrderDetail> CreateAsync(SaveWorkOrderRequest request, CancellationToken ct)
    {
        Validate(request);

        var number = request.Number.Trim();
        if (await db.WorkOrders.AnyAsync(w => w.Number == number, ct))
        {
            throw AppException.Conflict("number_in_use",
                $"Work order {number} already exists. Two contracts sharing a number would " +
                "silently merge their costs.");
        }

        if (!me.CanSeeSite(request.SiteId))
            throw AppException.Forbidden("You do not have access to that site.");

        var workOrder = new WorkOrder
        {
            Number = number,
            Title = request.Title.Trim(),
            ClientName = request.ClientName.Trim(),
            ClientReference = request.ClientReference?.Trim(),
            SiteId = request.SiteId,
            ContractValue = request.ContractValue,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            ScopeSummary = request.ScopeSummary?.Trim(),
            Notes = request.Notes?.Trim(),
        };

        ApplyHeader(workOrder, request);

        db.WorkOrders.Add(workOrder);
        await ApplyLinesAsync(workOrder, request.Lines, ct);
        await db.SaveChangesAsync(ct);

        return await GetAsync(workOrder.Id, ct);
    }

    public async Task<WorkOrderDetail> UpdateAsync(
        Guid id, SaveWorkOrderRequest request, CancellationToken ct)
    {
        Validate(request);

        var workOrder = await LoadAsync(id, ct);
        var number = request.Number.Trim();

        if (await db.WorkOrders.AnyAsync(w => w.Number == number && w.Id != id, ct))
            throw AppException.Conflict("number_in_use", $"Work order {number} already exists.");

        // Moving a work order between sites would orphan the orders already raised against
        // it at the old one, and the figures on both sites would then be wrong.
        if (workOrder.SiteId != request.SiteId
            && await db.PurchaseOrders.AnyAsync(o => o.WorkOrderId == id, ct))
        {
            throw AppException.BadRequest("has_orders",
                "Purchase orders have already been raised against this work order, so it " +
                "cannot be moved to another site.");
        }

        workOrder.Number = number;
        workOrder.Title = request.Title.Trim();
        workOrder.ClientName = request.ClientName.Trim();
        workOrder.ClientReference = request.ClientReference?.Trim();
        workOrder.SiteId = request.SiteId;
        workOrder.ContractValue = request.ContractValue;
        workOrder.StartDate = request.StartDate;
        workOrder.EndDate = request.EndDate;
        workOrder.ScopeSummary = request.ScopeSummary?.Trim();
        workOrder.Notes = request.Notes?.Trim();
        ApplyHeader(workOrder, request);

        await ApplyLinesAsync(workOrder, request.Lines, ct);

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    /// <summary>
    /// The rest of what is printed on the head of the client's order.
    /// </summary>
    /// <remarks>
    /// One place for both create and update, because a field set on the way in and forgotten
    /// on the way out is the kind of thing nobody notices until a bill goes to the wrong
    /// address.
    /// </remarks>
    private static void ApplyHeader(WorkOrder workOrder, SaveWorkOrderRequest request)
    {
        workOrder.OrderedOn = request.OrderedOn;
        workOrder.ProjectName = Clean(request.ProjectName);
        workOrder.ClientGstin = Clean(request.ClientGstin)?.ToUpperInvariant();
        workOrder.ClientAddress = Clean(request.ClientAddress);
        workOrder.BillingAddress = Clean(request.BillingAddress);
        workOrder.ClientContactName = Clean(request.ClientContactName);
        workOrder.ClientContactPhone = Clean(request.ClientContactPhone);
        workOrder.PaymentTerms = Clean(request.PaymentTerms);
        workOrder.AmendmentVersion = Clean(request.AmendmentVersion);
        workOrder.DiscountAmount = request.DiscountAmount;
        workOrder.CgstAmount = request.CgstAmount;
        workOrder.SgstAmount = request.SgstAmount;
        workOrder.IgstAmount = request.IgstAmount;
    }

    private static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// Replaces the itemised list with what was sent.
    /// </summary>
    /// <remarks>
    /// <para>Wholesale rather than merged: the screen sends the client's sheet as it now
    /// reads, and a line left off it is a line somebody deleted. Null means the caller is not
    /// editing the list at all — a status change must not wipe it.</para>
    /// </remarks>
    private async Task ApplyLinesAsync(
        WorkOrder workOrder, IReadOnlyList<SaveWorkOrderLineRequest>? lines, CancellationToken ct)
    {
        if (lines is null) return;

        var materialIds = lines.Select(l => l.MaterialId).Distinct().ToList();

        var known = await db.Materials.AsNoTracking()
            .Where(m => materialIds.Contains(m.Id))
            .Select(m => m.Id)
            .ToListAsync(ct);

        db.WorkOrderLines.RemoveRange(workOrder.Lines);
        workOrder.Lines.Clear();

        var order = 0;

        foreach (var line in lines)
        {
            if (!known.Contains(line.MaterialId))
                throw AppException.NotFound("One of those materials");

            if (line.Quantity <= 0)
            {
                throw AppException.BadRequest("invalid_quantity",
                    "Every item needs a quantity of more than zero — that is the whole point " +
                    "of listing it.");
            }

            if (line.Rate is < 0)
                throw AppException.BadRequest("invalid_rate", "A client rate cannot be negative.");

            // Through the DbSet, not the navigation: a child added to a tracked parent's
            // collection with a key already assigned is read by EF as an existing row.
            db.WorkOrderLines.Add(new WorkOrderLine
            {
                WorkOrderId = workOrder.Id,
                MaterialId = line.MaterialId,
                Quantity = line.Quantity,
                Rate = line.Rate,
                ClientItemCode = string.IsNullOrWhiteSpace(line.ClientItemCode)
                    ? null : line.ClientItemCode.Trim(),
                Description = string.IsNullOrWhiteSpace(line.Description) ? null : line.Description.Trim(),
                Section = Clean(line.Section),
                SacHsnCode = Clean(line.SacHsnCode),
                TaxPercent = line.TaxPercent,
                SortOrder = order++,
            });
        }
    }

    public async Task<WorkOrderDetail> SetStatusAsync(Guid id, string status, CancellationToken ct)
    {
        var workOrder = await LoadAsync(id, ct);

        if (!Enum.TryParse<WorkOrderStatus>(status, true, out var parsed))
            throw AppException.BadRequest("unknown_status", $"There is no status called '{status}'.");

        workOrder.Status = parsed;
        await db.SaveChangesAsync(ct);

        return await GetAsync(id, ct);
    }

    /// <summary>
    /// Moves an order onto a work order, or off one. The explicit ask: a purchase tagged to
    /// the wrong job makes both jobs' figures wrong, and that has to be fixable without
    /// unpicking an order that has already been sent to a supplier.
    /// </summary>
    public async Task<Guid?> AssignOrderAsync(Guid purchaseOrderId, Guid? workOrderId, CancellationToken ct)
    {
        var order = await db.PurchaseOrders.FirstOrDefaultAsync(o => o.Id == purchaseOrderId, ct)
                    ?? throw AppException.NotFound("That purchase order");

        if (!me.CanSeeSite(order.SiteId))
            throw AppException.Forbidden("That order belongs to a site you do not have access to.");

        if (workOrderId is { } id)
        {
            var workOrder = await db.WorkOrders.AsNoTracking()
                .FirstOrDefaultAsync(w => w.Id == id, ct)
                ?? throw AppException.NotFound("That work order");

            if (workOrder.SiteId != order.SiteId)
            {
                throw AppException.BadRequest("different_site",
                    $"{workOrder.Number} is for a different site. A purchase for one site " +
                    "cannot be costed against another site's contract.");
            }

            if (!workOrder.IsOpen)
            {
                throw AppException.BadRequest("work_order_closed",
                    $"{workOrder.Number} is {workOrder.Status.ToString().ToLowerInvariant()}. " +
                    "Reopen it first if this purchase really belongs to it.");
            }
        }

        order.WorkOrderId = workOrderId;
        await db.SaveChangesAsync(ct);

        return workOrderId;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private async Task<WorkOrder> LoadAsync(Guid id, CancellationToken ct)
    {
        var workOrder = await db.WorkOrders
            .Include(w => w.Site)
            .Include(w => w.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
            .AsSplitQuery()
            .FirstOrDefaultAsync(w => w.Id == id, ct)
            ?? throw AppException.NotFound("That work order");

        if (!me.CanSeeSite(workOrder.SiteId))
            throw AppException.Forbidden("That work order belongs to a site you do not have access to.");

        return workOrder;
    }

    /// <summary>
    /// What the client asked for, beside what has actually been ordered against it.
    /// </summary>
    /// <remarks>
    /// <para>Compared by material, and summed across every live order on the contract —
    /// one work order carries many purchase orders, and the question "have we bought more
    /// switches than they asked for" is only answerable across all of them at once.</para>
    ///
    /// <para>Materials bought against the contract that are not on the client's sheet at all
    /// are listed too, at the bottom. They are the other half of the same question: an
    /// over-run does not always announce itself as a bigger number on a line you expected.</para>
    /// </remarks>
    private async Task<IReadOnlyList<WorkOrderCoverageRow>> CoverageAsync(
        WorkOrder workOrder, CancellationToken ct)
    {
        // The lines themselves, not their totals: the same rows add up to the total and
        // also say which order each came from, so one query serves both.
        var lines = await db.PurchaseOrderLines.AsNoTracking()
            .Where(l => l.PurchaseOrder.WorkOrderId == workOrder.Id
                        && l.PurchaseOrder.Status != PurchaseOrderStatus.Cancelled)
            .Select(l => new
            {
                l.MaterialId,
                l.Id,
                OrderId = l.PurchaseOrder.Id,
                Number = l.PurchaseOrder.Number,
                SupplierName = l.PurchaseOrder.Supplier.Name,
                Status = l.PurchaseOrder.Status,
                l.PurchaseOrder.IssuedAt,
                l.Quantity,
                Value = l.LineTotal,
            })
            .ToListAsync(ct);

        var receivedByLine = await db.GoodsReceiptLines.AsNoTracking()
            .Where(l => l.GoodsReceipt.Status == Domain.Receiving.GoodsReceiptStatus.Accepted
                        && l.PurchaseOrderLine.PurchaseOrder.WorkOrderId == workOrder.Id)
            .GroupBy(l => l.PurchaseOrderLineId)
            .Select(g => new { LineId = g.Key, Got = g.Sum(l => l.AcceptedQuantity) })
            .ToDictionaryAsync(x => x.LineId, x => x.Got, ct);

        var ordered = lines
            .GroupBy(l => l.MaterialId)
            .ToDictionary(g => g.Key, g => new
            {
                MaterialId = g.Key,
                Quantity = g.Sum(l => l.Quantity),
                Value = g.Sum(l => l.Value),
            });

        var breakdown = lines
            .GroupBy(l => l.MaterialId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<CoverageOrderDto>)g
                    .GroupBy(l => new { l.OrderId, l.Number, l.SupplierName, l.Status, l.IssuedAt })
                    .Select(o => new CoverageOrderDto(
                        o.Key.OrderId, o.Key.Number, o.Key.SupplierName,
                        o.Key.Status.ToString(), o.Key.IssuedAt,
                        o.Sum(l => l.Quantity),
                        o.Sum(l => receivedByLine.TryGetValue(l.Id, out var got) ? got : 0m),
                        o.Sum(l => l.Value)))
                    .OrderByDescending(o => o.IssuedAt)
                    .ToList());

        var received = await db.GoodsReceiptLines.AsNoTracking()
            .Where(l => l.GoodsReceipt.Status == Domain.Receiving.GoodsReceiptStatus.Accepted
                        && l.PurchaseOrderLine.PurchaseOrder.WorkOrderId == workOrder.Id)
            .GroupBy(l => l.PurchaseOrderLine.MaterialId)
            .Select(g => new { MaterialId = g.Key, Quantity = g.Sum(l => l.AcceptedQuantity) })
            .ToDictionaryAsync(x => x.MaterialId, x => x.Quantity, ct);

        var rows = new List<WorkOrderCoverageRow>();

        foreach (var line in workOrder.Lines.OrderBy(l => l.SortOrder))
        {
            ordered.TryGetValue(line.MaterialId, out var bought);
            received.TryGetValue(line.MaterialId, out var got);

            breakdown.TryGetValue(line.MaterialId, out var orders);

            rows.Add(Row(
                line.Material, line, line.Quantity, line.Rate,
                bought?.Quantity ?? 0m, got, bought?.Value ?? 0m, onWorkOrder: true,
                orders ?? []));
        }

        // Bought against this contract but never asked for by the client.
        var listed = workOrder.Lines.Select(l => l.MaterialId).ToHashSet();
        var strayIds = ordered.Keys.Where(id => !listed.Contains(id)).ToList();

        if (strayIds.Count > 0)
        {
            var strays = await db.Materials.AsNoTracking().Include(m => m.Unit)
                .Where(m => strayIds.Contains(m.Id))
                .ToListAsync(ct);

            foreach (var material in strays.OrderBy(m => m.Name))
            {
                received.TryGetValue(material.Id, out var got);
                var bought = ordered[material.Id];

                breakdown.TryGetValue(material.Id, out var strayOrders);

                rows.Add(Row(material, line: null, wanted: 0m, rate: null,
                    bought.Quantity, got, bought.Value, onWorkOrder: false,
                    strayOrders ?? []));
            }
        }

        return rows;
    }

    /// <param name="line">Null for a material bought against the contract but never listed.</param>
    private static WorkOrderCoverageRow Row(
        Domain.Catalog.Material material, WorkOrderLine? line,
        decimal wanted, decimal? rate,
        decimal ordered, decimal received, decimal orderedValue, bool onWorkOrder,
        IReadOnlyList<CoverageOrderDto> orders)
    {
        var percent = wanted > 0 ? (double)Math.Round(ordered / wanted * 100m, 1) : 0d;

        var tone = !onWorkOrder ? "bad"
            : ordered > wanted ? "bad"
            : percent >= 80 ? "watch"
            : "ok";

        return new WorkOrderCoverageRow(
            material.Id, material.Code, material.Name, material.Unit.Code,
            material.Unit.DecimalPlaces, line?.ClientItemCode, line?.Description,
            line?.Section, line?.SacHsnCode, line?.TaxPercent,
            wanted, rate, Math.Round(wanted * (rate ?? 0m), 2),
            ordered, received, Math.Max(0m, wanted - ordered),
            percent, Math.Round(orderedValue, 2), onWorkOrder, tone, orders);
    }

    private readonly record struct Spend(decimal Value, int Count);

    private async Task<Dictionary<Guid, Spend>> CommittedAsync(
        List<Guid> workOrderIds, CancellationToken ct)
    {
        if (workOrderIds.Count == 0) return [];

        var rows = await db.PurchaseOrders.AsNoTracking()
            .Where(o => o.WorkOrderId != null
                        && workOrderIds.Contains(o.WorkOrderId!.Value)
                        && o.Status != PurchaseOrderStatus.Cancelled)
            .GroupBy(o => o.WorkOrderId!.Value)
            .Select(g => new { Id = g.Key, Value = g.Sum(o => o.GrandTotal), Count = g.Count() })
            .ToListAsync(ct);

        return rows.ToDictionary(r => r.Id, r => new Spend(r.Value, r.Count));
    }

    private static double Percent(decimal part, decimal whole) =>
        whole > 0 ? (double)Math.Round(part / whole * 100m, 1) : 0d;

    private static void Validate(SaveWorkOrderRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Number))
            throw AppException.BadRequest("number_required", "Enter the client's work order number.");

        if (string.IsNullOrWhiteSpace(request.Title))
            throw AppException.BadRequest("title_required", "Give it a name you will recognise in a list.");

        if (string.IsNullOrWhiteSpace(request.ClientName))
            throw AppException.BadRequest("client_required", "Who awarded it?");

        if (request.ContractValue <= 0)
        {
            throw AppException.BadRequest("value_required",
                "Enter the contract value. Without it there is nothing to measure purchases against.");
        }

        if (request.StartDate is { } start && request.EndDate is { } end && end < start)
            throw AppException.BadRequest("bad_dates", "The completion date is before the start date.");
    }
}
