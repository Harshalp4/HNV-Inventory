using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Paging;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Notifications;
using SiteStock.Api.Features.Budgets;
using SiteStock.Api.Features.Notifications;
using SiteStock.Api.Features.PurchaseOrders;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Requisitions;

public sealed class RequisitionService(
    SiteStockDbContext db,
    DocumentNumberService numbers,
    PurchaseOrderFactory orderFactory,
    BudgetReader budgets,
    NotificationService notifications,
    ICurrentUser me,
    TimeProvider clock,
    ILogger<RequisitionService> logger)
{
    // ── reading ──────────────────────────────────────────────────────────────

    public async Task<PagedResult<RequisitionListItem>> ListAsync(
        RequisitionQuery query, CancellationToken ct)
    {
        var page = new PageRequest { Page = query.Page ?? 1, PageSize = query.PageSize ?? 50 };

        var requisitions = Queryable().AsNoTracking();

        if (query.SiteId is { } siteId)
        {
            // Asking for a site you cannot see is a refusal, not an empty list — an empty
            // list would quietly tell you the site exists and has nothing in it.
            if (!me.CanSeeSite(siteId)) throw AppException.Forbidden("You do not have access to that site.");
            requisitions = requisitions.Where(r => r.SiteId == siteId);
        }
        else if (!me.HasAllSites)
        {
            var permitted = me.SiteIds.ToList();
            requisitions = requisitions.Where(r => permitted.Contains(r.SiteId));
        }

        if (!string.IsNullOrWhiteSpace(query.Status)
            && Enum.TryParse<RequisitionStatus>(query.Status, true, out var status))
        {
            requisitions = requisitions.Where(r => r.Status == status);
        }

        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var term = $"%{query.Q.Trim()}%";
            requisitions = requisitions.Where(r =>
                EF.Functions.ILike(r.Number, term) ||
                r.Lines.Any(l => EF.Functions.ILike(l.Material.Name, term)));
        }

        // A draft is private to whoever is writing it — the guide promises exactly this,
        // and until now the promise was not kept.
        requisitions = requisitions.Where(r =>
            r.Status != RequisitionStatus.Draft || r.RequestedById == me.Id);

        if (query.MineToAction == true)
        {
            // The queue: what is sitting on this person's desk, by permission rather than
            // by role name, so a combined role sees both queues without special-casing.
            var waiting = new List<RequisitionStatus>();
            if (me.Can(Permissions.RequisitionsPrice)) waiting.Add(RequisitionStatus.Submitted);
            if (me.Can(Permissions.PurchasesApprove)) waiting.Add(RequisitionStatus.Priced);
            if (me.Can(Permissions.RequisitionsCreate)) waiting.Add(RequisitionStatus.Draft);

            requisitions = waiting.Count == 0
                ? requisitions.Where(_ => false)
                : requisitions.Where(r => waiting.Contains(r.Status));
        }

        var total = await requisitions.CountAsync(ct);
        var now = clock.GetUtcNow();

        var items = await requisitions
            // Urgent first, then oldest first — the thing most likely to stop work is at the top.
            .OrderByDescending(r => r.Priority == RequisitionPriority.Urgent)
            .ThenBy(r => r.RequiredBy)
            .ThenBy(r => r.CreatedAt)
            .Skip(page.Skip).Take(page.SafePageSize)
            .ToListAsync(ct);

        var seesPrices = me.Can(Permissions.PricesRead);

        return new PagedResult<RequisitionListItem>(
            items.Select(r => new RequisitionListItem(
                r.Id, r.Number, r.SiteId, r.Site.Code, r.Site.Name,
                r.Status.ToString(), r.Priority.ToString(), r.RequiredBy,
                r.RequestedBy.FullName, r.Lines.Count,
                // A supervisor is shown what was asked for, never what it costs.
                seesPrices ? r.Lines.Sum(l => l.LineTotalWithTax) : null,
                r.CreatedAt, r.SubmittedAt,
                WaitingHours(r, now),
                r.AmendedAt, r.AmendedAfterPricingAt)).ToList(),
            page.SafePage, page.SafePageSize, total);
    }

    public async Task<RequisitionDetail> GetAsync(Guid id, CancellationToken ct)
    {
        var requisition = await LoadAsync(id, ct);
        return await DescribeAsync(requisition, ct);
    }

    // ── writing ──────────────────────────────────────────────────────────────

    public async Task<RequisitionDetail> CreateAsync(SaveRequisitionRequest request, CancellationToken ct)
    {
        if (!me.CanSeeSite(request.SiteId))
            throw AppException.Forbidden("You cannot raise a requisition for that site.");

        var site = await db.Sites.FirstOrDefaultAsync(s => s.Id == request.SiteId && s.IsActive, ct)
                   ?? throw AppException.NotFound("That site");

        ValidateRequiredBy(request.RequiredBy);
        await ValidateLinesAsync(request.Lines, ct);

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        var requisition = new Requisition
        {
            Number = await numbers.NextAsync("REQ", site.Code, ct),
            SiteId = site.Id,
            RequestedById = me.Id,
            Status = RequisitionStatus.Draft,
            Priority = ParsePriority(request.Priority),
            RequiredBy = request.RequiredBy,
            Notes = request.Notes?.Trim(),
            WorkOrderId = await ValidateWorkOrderAsync(request.WorkOrderId, site.Id, ct),
        };

        foreach (var line in request.Lines)
        {
            requisition.Lines.Add(new RequisitionLine
            {
                MaterialId = line.MaterialId,
                Quantity = line.Quantity,
                Notes = line.Notes?.Trim(),
            });
        }

        db.Requisitions.Add(requisition);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return await GetAsync(requisition.Id, ct);
    }

    public async Task<RequisitionDetail> UpdateAsync(
        Guid id, SaveRequisitionRequest request, CancellationToken ct)
    {
        var requisition = await LoadAsync(id, ct);

        if (!requisition.IsEditable)
        {
            throw AppException.BadRequest("not_editable",
                "This requisition has already been submitted, so its lines are fixed. " +
                "Ask the purchase head to send it back if something needs changing.");
        }

        if (requisition.RequestedById != me.Id)
            throw AppException.Forbidden("Only the person who raised it can edit a draft.");

        ValidateRequiredBy(request.RequiredBy);
        await ValidateLinesAsync(request.Lines, ct);

        requisition.Priority = ParsePriority(request.Priority);
        requisition.RequiredBy = request.RequiredBy;
        requisition.Notes = request.Notes?.Trim();
        requisition.WorkOrderId = await ValidateWorkOrderAsync(request.WorkOrderId, requisition.SiteId, ct);

        // Lines are replaced wholesale. A draft has no downstream references yet, so there
        // is nothing to preserve, and reconciling an edit list would be more code and more
        // ways to be wrong.
        db.RequisitionLines.RemoveRange(requisition.Lines);
        requisition.Lines.Clear();

        foreach (var line in request.Lines)
        {
            // Added through the DbSet, not only through the navigation. Our keys are assigned
            // in the constructor (Guid.CreateVersion7), and EF classifies a child attached to
            // an already-tracked parent by whether its key is set — a non-default key is read
            // as "existing", so it would emit an UPDATE that matches no row.
            var newLine = new RequisitionLine
            {
                RequisitionId = requisition.Id,
                MaterialId = line.MaterialId,
                Quantity = line.Quantity,
                Notes = line.Notes?.Trim(),
            };

            // Only through the DbSet. EF's fixup puts it into requisition.Lines for us —
            // adding it to the navigation as well would leave the same reference in the
            // collection twice and duplicate it in the response.
            db.RequisitionLines.Add(newLine);
        }

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    /// <summary>
    /// What the client's work order covers for each material on this request, and how much
    /// has already been ordered against it.
    /// </summary>
    /// <remarks>
    /// <para>The question the buyer is actually asking at the moment of pricing is not "what
    /// is left in the budget" but "did the client ask for this many". Answered here so the
    /// same figures reach the pricing screen, the approval screen and the supervisor who
    /// raised it — quantities carry no money, so nothing has to be hidden from anybody.</para>
    ///
    /// <para>Orders raised from this very request are counted like any other: they are real
    /// commitments. The screen says "already ordered" and means it.</para>
    /// </remarks>
    private async Task<Dictionary<Guid, WorkOrderCover>> CoverAsync(
        Requisition requisition, CancellationToken ct)
    {
        var empty = new Dictionary<Guid, WorkOrderCover>();
        if (requisition.WorkOrderId is not { } workOrderId) return empty;

        var lines = await db.WorkOrderLines.AsNoTracking()
            .Where(l => l.WorkOrderId == workOrderId)
            .GroupBy(l => l.MaterialId)
            .Select(g => new { MaterialId = g.Key, Quantity = g.Sum(l => l.Quantity) })
            .ToListAsync(ct);

        // Nobody has typed the client's sheet in, so there is nothing to check against and
        // an empty answer is the honest one.
        if (lines.Count == 0) return empty;

        var ordered = await db.PurchaseOrderLines.AsNoTracking()
            .Where(l => l.PurchaseOrder.WorkOrderId == workOrderId
                        && l.PurchaseOrder.Status != Domain.Procurement.PurchaseOrderStatus.Cancelled)
            .GroupBy(l => l.MaterialId)
            .Select(g => new { MaterialId = g.Key, Quantity = g.Sum(l => l.Quantity) })
            .ToDictionaryAsync(x => x.MaterialId, x => x.Quantity, ct);

        var number = requisition.WorkOrder?.Number ?? "the work order";
        var covered = lines.ToDictionary(l => l.MaterialId, l => l.Quantity);
        var result = new Dictionary<Guid, WorkOrderCover>();

        foreach (var materialId in requisition.Lines.Select(l => l.MaterialId).Distinct())
        {
            ordered.TryGetValue(materialId, out var bought);

            if (covered.TryGetValue(materialId, out var wanted))
            {
                result[materialId] = new WorkOrderCover(number, wanted, bought, wanted - bought, true);
            }
            else
            {
                // On the contract's orders but never on the client's sheet. Worth saying
                // plainly rather than leaving blank, which reads as "checked, and fine".
                result[materialId] = new WorkOrderCover(number, 0m, bought, 0m, false);
            }
        }

        return result;
    }

    /// <summary>Trimmed, or null — an empty box and a box nobody filled in are the same thing.</summary>
    private static string? Blank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// The purchase head's move: award every line to a supplier at a rate, keeping the
    /// quotes that were compared. Partial pricing is refused — the owner must never be
    /// shown a total that is missing a line.
    /// </summary>
    /// <summary>
    /// Costs a request to a client contract, on its own.
    /// </summary>
    /// <remarks>
    /// <para>The buyer is the one who knows which contract pays for a request — a supervisor
    /// asking for cement is not thinking about that — so it has to be settable after the
    /// request was raised, and without having to price the whole thing first.</para>
    /// <para>Allowed right up until the orders are raised. After that the spend is already
    /// booked against a contract and moving it would silently rewrite what that job cost.</para>
    /// </remarks>
    public async Task<RequisitionDetail> SetWorkOrderAsync(
        Guid id, Guid? workOrderId, CancellationToken ct)
    {
        var requisition = await LoadAsync(id, ct);

        var orders = await db.PurchaseOrders
            .Where(o => o.RequisitionId == id && o.Status != PurchaseOrderStatus.Cancelled)
            .ToListAsync(ct);

        // An order the supplier has already been told about carries a job on the paper he
        // is holding. Re-costing that behind his back would make our books disagree with
        // his. An order still sitting here unsent has told nobody anything yet.
        var sent = orders.Where(o => o.Status != PurchaseOrderStatus.Issued).ToList();

        if (sent.Count > 0)
        {
            throw AppException.BadRequest("orders_sent",
                $"{string.Join(", ", sent.Select(o => o.Number))} " +
                (sent.Count == 1 ? "has" : "have") +
                " already gone to the supplier, so this request can no longer be re-costed. " +
                "Set the job on the order itself instead.");
        }

        var job = await ValidateWorkOrderAsync(workOrderId, requisition.SiteId, ct);
        requisition.WorkOrderId = job;

        // The orders follow the request they came from. A buyer who costs a request after
        // raising it means the orders too, and leaving them behind is how a job ends up
        // showing none of its own spend.
        foreach (var order in orders)
        {
            if (order.WorkOrderId == job) continue;

            order.WorkOrderId = job;
            db.PurchaseOrderChanges.Add(new Domain.Procurement.PurchaseOrderChange
            {
                PurchaseOrderId = order.Id,
                Summary = job is null
                    ? "No longer costed to a job"
                    : "Costed to the job set on the request it came from",
                ChangedById = me.Id,
            });
        }

        await db.SaveChangesAsync(ct);

        return await GetAsync(id, ct);
    }

    public async Task<RequisitionDetail> PriceAsync(
        Guid id, PriceRequisitionRequest request, CancellationToken ct)
    {
        var requisition = await LoadAsync(id, ct);
        RequisitionStateMachine.EnsureAllowed(requisition, RequisitionAction.Price, me, null);

        // Costed to a job before the figures are worked out, so the cover shown against
        // each line is the cover for the contract the money will actually come out of.
        if (request.WorkOrderId is { } job)
        {
            requisition.WorkOrderId =
                await ValidateWorkOrderAsync(job, requisition.SiteId, ct);
        }

        var byId = requisition.Lines.ToDictionary(l => l.Id);
        var supplied = request.Lines.Select(l => l.LineId).ToHashSet();

        // A part-priced request is exactly what saving is for; only sending demands a
        // complete set, because that is the point the owner is asked to commit.
        var missing = requisition.Lines.Where(l => !supplied.Contains(l.Id)).ToList();
        if (request.Submit && missing.Count > 0)
        {
            throw AppException.BadRequest("incomplete_pricing",
                $"{missing.Count} line(s) still have no supplier or rate: " +
                string.Join(", ", missing.Select(l => l.Material.Name)) +
                ". The owner should never be asked to approve a partial total.");
        }

        var supplierIds = request.Lines.Select(l => l.AwardedSupplierId)
            .Concat(request.Lines.SelectMany(l => l.Quotes ?? []).Select(q => q.SupplierId))
            .Distinct().ToList();

        var known = await db.Suppliers
            .Where(s => supplierIds.Contains(s.Id) && s.IsActive)
            .Select(s => s.Id).ToListAsync(ct);

        foreach (var priced in request.Lines)
        {
            if (!byId.TryGetValue(priced.LineId, out var line))
                throw AppException.BadRequest("unknown_line", "A priced line does not belong to this requisition.");

            if (!known.Contains(priced.AwardedSupplierId))
                throw AppException.NotFound("That supplier");

            // Only when the rate is being typed. With a list price and a discount the rate is
            // derived below, and demanding a valid one here as well would refuse a perfectly
            // good ₹100 less 40% for having sent no rate of its own.
            if (priced.ListRate is null && priced.UnitRate <= 0)
                throw AppException.BadRequest("invalid_rate", $"The rate for {line.Material.Name} must be more than zero.");

            if (priced.TaxPercent is < 0 or > 100)
                throw AppException.BadRequest("invalid_tax", "GST must be between 0 and 100 percent.");

            if (priced.ListRate is <= 0)
            {
                throw AppException.BadRequest("invalid_list_rate",
                    $"The list price for {line.Material.Name} must be more than zero. Leave it " +
                    "blank if the supplier quoted one net figure.");
            }

            if (priced.DiscountPercent is < 0 or >= 100)
                throw AppException.BadRequest("invalid_discount", "A discount must be between 0 and 100 percent.");

            if (priced.DiscountPercent is not null && priced.ListRate is null)
            {
                throw AppException.BadRequest("discount_without_list",
                    $"{line.Material.Name} has a discount but no list price. A discount off nothing " +
                    "is not a rate anybody can check.");
            }

            line.AwardedSupplierId = priced.AwardedSupplierId;
            line.ProductCode = Blank(priced.ProductCode);
            line.Make = Blank(priced.Make);
            line.ListRate = priced.ListRate;
            line.DiscountPercent = priced.ListRate is null ? null : priced.DiscountPercent;

            // Derived, never taken from the client: the list price, the discount and the rate
            // are printed side by side on the order, and three figures that can disagree are
            // three figures a supplier will argue about.
            line.UnitRate = priced.ListRate is { } list
                ? Math.Round(list * (1m - (priced.DiscountPercent ?? 0m) / 100m), 4)
                : priced.UnitRate;

            if (line.UnitRate <= 0)
            {
                throw AppException.BadRequest("invalid_rate",
                    $"The list price and discount for {line.Material.Name} leave nothing to pay.");
            }

            line.TaxPercent = priced.TaxPercent;
            line.PricingNotes = priced.PricingNotes?.Trim();

            db.RequisitionQuotes.RemoveRange(line.Quotes);
            line.Quotes.Clear();

            foreach (var quote in priced.Quotes ?? [])
            {
                if (!known.Contains(quote.SupplierId)) continue;

                // See the note in UpdateAsync: a child of a tracked parent must be added
                // through the DbSet, or EF reads its pre-assigned key as "already exists".
                var newQuote = new RequisitionQuote
                {
                    RequisitionLineId = line.Id,
                    SupplierId = quote.SupplierId,
                    UnitRate = quote.UnitRate,
                    TaxPercent = quote.TaxPercent,
                    LeadTimeDays = quote.LeadTimeDays,
                    Notes = quote.Notes?.Trim(),
                };

                db.RequisitionQuotes.Add(newQuote);
            }
        }

        requisition.SupplierNote = Blank(request.SupplierNote);

        // Credit agreed for this purchase. Rewritten wholesale rather than merged: the screen
        // sends what it shows, and a term left off it is a term the buyer has taken away.
        db.RequisitionSupplierTerms.RemoveRange(requisition.SupplierTerms);
        requisition.SupplierTerms.Clear();

        var awarded = request.Lines.Select(l => l.AwardedSupplierId).ToHashSet();

        foreach (var term in request.SupplierTerms ?? [])
        {
            // Terms for a supplier who ended up with nothing would sit here misleading
            // whoever reads the request next.
            if (!awarded.Contains(term.SupplierId)) continue;

            if (term.PaymentTermsDays is < 0 or > 180)
                throw AppException.BadRequest("invalid_terms", "Credit must be between 0 and 180 days.");

            db.RequisitionSupplierTerms.Add(new RequisitionSupplierTerm
            {
                RequisitionId = requisition.Id,
                SupplierId = term.SupplierId,
                PaymentTermsDays = term.PaymentTermsDays,
            });
        }
        if (!request.Submit)
        {
            // Saved, not sent: the rates are kept, the request stays where it was, and the
            // owner hears nothing about work that is not finished.
            await db.SaveChangesAsync(ct);
            return await GetAsync(id, ct);
        }

        requisition.Status = RequisitionStatus.Priced;
        requisition.PricedAt = clock.GetUtcNow();
        requisition.PricedById = me.Id;

        var total = requisition.Lines.Sum(l => l.LineTotalWithTax);

        await notifications.RaiseForPermissionAsync(
            Permissions.PurchasesApprove, requisition.SiteId,
            NotificationKind.RequisitionPriced,
            $"{requisition.Number} needs your approval",
            $"{requisition.Site.Name} · \u20b9{total:N0} · priced by {me.FullName}",
            $"/requisitions/{requisition.Id}",
            requisition.Priority == RequisitionPriority.Urgent
                ? NotificationUrgency.Urgent : NotificationUrgency.Normal,
            alsoEmail: true, ct: ct);

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    /// <summary>
    /// Every other move in the workflow. The state machine decides whether it is legal and
    /// whether a reason is required; approval additionally generates the purchase orders.
    /// </summary>
    public async Task<RequisitionDetail> TransitionAsync(
        Guid id, RequisitionAction action, string? reason, CancellationToken ct)
    {
        var requisition = await LoadAsync(id, ct);
        var target = RequisitionStateMachine.EnsureAllowed(requisition, action, me, reason);
        var now = clock.GetUtcNow();

        if (action is RequisitionAction.Submit)
        {
            if (requisition.RequestedById != me.Id)
                throw AppException.Forbidden("Only the person who raised it can submit it.");

            if (requisition.Lines.Count == 0)
                throw AppException.BadRequest("no_lines", "Add at least one material before submitting.");

            requisition.SubmittedAt = now;

            await notifications.RaiseForPermissionAsync(
                Permissions.RequisitionsPrice, requisition.SiteId,
                NotificationKind.RequisitionSubmitted,
                $"{requisition.Number} needs pricing",
                $"{requisition.Site.Name} · {requisition.Lines.Count} material(s) · " +
                $"needed by {requisition.RequiredBy:d MMM}",
                $"/requisitions/{requisition.Id}",
                requisition.Priority == RequisitionPriority.Urgent
                    ? NotificationUrgency.Urgent : NotificationUrgency.Normal,
                ct: ct);
        }

        if (action is RequisitionAction.Cancel && requisition.Status == RequisitionStatus.Draft
            && requisition.RequestedById != me.Id)
        {
            throw AppException.Forbidden("Only the person who raised it can cancel their own draft.");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        if (action is RequisitionAction.Approve)
        {
            // The budget block. An owner over the limit may still approve, but only
            // deliberately and only on the record — which is the difference between a
            // control and a speed bump.
            var total = requisition.Lines.Sum(l => l.LineTotalWithTax);
            var budget = await budgets.SnapshotAsync(requisition.SiteId, total, ct);

            if (budget.RequiresOverride)
            {
                if (string.IsNullOrWhiteSpace(reason))
                {
                    throw AppException.BadRequest("budget_exceeded",
                        $"{requisition.Site.Name} would go to {budget.PercentUsedAfter:0.#}% of its " +
                        $"budget for {budget.FinancialYear} — ₹{Math.Abs(budget.RemainingAfter):N0} " +
                        "beyond the limit. You can still approve it, but you must say why, and " +
                        "the reason is recorded against your name.");
                }

                budgets.RecordOverride(
                    requisition.SiteId, budget.FinancialYear, requisition.Id,
                    Math.Abs(budget.RemainingAfter), reason, me.Id);

                logger.LogWarning(
                    "Budget override on {Requisition} at {Site}: {Percent}% of {Year} budget. {Reason}",
                    requisition.Number, requisition.Site.Name, budget.PercentUsedAfter,
                    budget.FinancialYear, reason);
            }

            if (requisition.RequestedById == me.Id)
            {
                logger.LogInformation(
                    "{Requisition} was raised and approved by the same person ({Name}). " +
                    "Recorded on the timeline.", requisition.Number, me.FullName);
            }

            // Approval is the only place purchase orders come into existence, and it happens
            // in the same transaction as the status change — there is no window in which a
            // requisition is approved but its orders do not exist.
            await orderFactory.CreateFromApprovedRequisitionAsync(requisition, ct);
        }

        if (action is RequisitionAction.SendBackForRepricing)
        {
            // Send-back clears the award so the purchase head re-decides rather than
            // re-submitting the figures the owner just declined.
            requisition.PricedAt = null;
            requisition.PricedById = null;
        }

        // Whoever raised it always finds out what happened to it.
        if (action is RequisitionAction.Approve or RequisitionAction.Reject
            or RequisitionAction.SendBackToDraft or RequisitionAction.SendBackForRepricing)
        {
            var (kind, headline, urgency) = action switch
            {
                RequisitionAction.Approve => (
                    NotificationKind.RequisitionApproved,
                    $"{requisition.Number} approved", NotificationUrgency.Normal),
                RequisitionAction.Reject => (
                    NotificationKind.RequisitionRejected,
                    $"{requisition.Number} was rejected", NotificationUrgency.Urgent),
                _ => (
                    NotificationKind.RequisitionSentBack,
                    $"{requisition.Number} was sent back", NotificationUrgency.Normal),
            };

            notifications.Raise(
                [requisition.RequestedById], kind, headline,
                string.IsNullOrWhiteSpace(reason) ? $"By {me.FullName}." : reason.Trim(),
                $"/requisitions/{requisition.Id}", requisition.SiteId, urgency,
                alsoEmail: action is RequisitionAction.Reject);

            // Sending back for re-pricing lands on the purchase head, not the raiser.
            if (action is RequisitionAction.SendBackForRepricing)
            {
                await notifications.RaiseForPermissionAsync(
                    Permissions.RequisitionsPrice, requisition.SiteId,
                    NotificationKind.RequisitionSentBack,
                    $"{requisition.Number} came back for another quote",
                    reason?.Trim(), $"/requisitions/{requisition.Id}",
                    NotificationUrgency.Normal, ct: ct);
            }
        }

        requisition.Status = target;
        requisition.DecisionReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();

        if (action is RequisitionAction.Approve or RequisitionAction.Reject)
        {
            requisition.DecidedAt = now;
            requisition.DecidedById = me.Id;
        }

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return await GetAsync(id, ct);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// <summary>
    /// How many requests sit in each state.
    /// </summary>
    /// <remarks>
    /// The same scoping as the list — a count the filter shows must agree with the list the
    /// filter produces, or the chips become a second, quieter source of truth.
    /// </remarks>
    public async Task<RequisitionCounts> CountsAsync(Guid? siteId, CancellationToken ct)
    {
        var rows = db.Requisitions.AsNoTracking().AsQueryable();

        if (siteId is { } id)
        {
            if (!me.CanSeeSite(id)) throw AppException.Forbidden("You do not have access to that site.");
            rows = rows.Where(r => r.SiteId == id);
        }
        else if (!me.HasAllSites)
        {
            var permitted = me.SiteIds.ToList();
            rows = rows.Where(r => permitted.Contains(r.SiteId));
        }

        // Somebody else's unfinished draft is not yours to count, any more than to read.
        rows = rows.Where(r => r.Status != RequisitionStatus.Draft || r.RequestedById == me.Id);

        var byStatus = await rows
            .GroupBy(r => r.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Status, x => x.Count, ct);

        int Count(RequisitionStatus status) => byStatus.TryGetValue(status, out var n) ? n : 0;

        var waiting = new List<RequisitionStatus>();
        if (me.Can(Permissions.RequisitionsPrice)) waiting.Add(RequisitionStatus.Submitted);
        if (me.Can(Permissions.PurchasesApprove)) waiting.Add(RequisitionStatus.Priced);
        if (me.Can(Permissions.RequisitionsCreate)) waiting.Add(RequisitionStatus.Draft);

        return new RequisitionCounts(
            byStatus.Values.Sum(),
            waiting.Sum(Count),
            Count(RequisitionStatus.Draft),
            Count(RequisitionStatus.Submitted),
            Count(RequisitionStatus.Priced),
            Count(RequisitionStatus.Approved),
            Count(RequisitionStatus.Rejected),
            Count(RequisitionStatus.Cancelled));
    }

    private IQueryable<Requisition> Queryable() => db.Requisitions
        .Include(r => r.Site)
        .Include(r => r.WorkOrder)
        .Include(r => r.RequestedBy)
        .Include(r => r.PricedBy)
        .Include(r => r.DecidedBy)
        .Include(r => r.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
        .Include(r => r.Lines).ThenInclude(l => l.AwardedSupplier)
        .Include(r => r.Lines).ThenInclude(l => l.Quotes).ThenInclude(q => q.Supplier)
        .Include(r => r.PurchaseOrders).ThenInclude(o => o.Supplier)
        .Include(r => r.PurchaseOrders).ThenInclude(o => o.CancelledBy)
        .Include(r => r.Amendments).ThenInclude(a => a.ChangedBy)
        .Include(r => r.SupplierTerms).ThenInclude(t => t.Supplier)
        .AsSplitQuery();

    private async Task<Requisition> LoadAsync(Guid id, CancellationToken ct)
    {
        var requisition = await Queryable().FirstOrDefaultAsync(r => r.Id == id, ct)
                          ?? throw AppException.NotFound("That requisition");

        if (!me.CanSeeSite(requisition.SiteId))
            throw AppException.Forbidden("This requisition belongs to a site you do not have access to.");

        // Same rule as the list: somebody else's unfinished draft is not yours to read.
        if (requisition.Status == RequisitionStatus.Draft && requisition.RequestedById != me.Id)
            throw AppException.NotFound("That requisition");

        return requisition;
    }

    /// <summary>
    /// A purchase for one site cannot be costed against another site's contract — that
    /// would quietly make two jobs' figures wrong at once.
    /// </summary>
    private async Task<Guid?> ValidateWorkOrderAsync(Guid? workOrderId, Guid siteId, CancellationToken ct)
    {
        if (workOrderId is not { } id) return null;

        var workOrder = await db.WorkOrders.AsNoTracking().FirstOrDefaultAsync(w => w.Id == id, ct)
                        ?? throw AppException.NotFound("That work order");

        if (workOrder.SiteId != siteId)
        {
            throw AppException.BadRequest("different_site",
                $"{workOrder.Number} is for a different site.");
        }

        if (!workOrder.IsOpen)
        {
            throw AppException.BadRequest("work_order_closed",
                $"{workOrder.Number} is {workOrder.Status.ToString().ToLowerInvariant()}.");
        }

        return id;
    }

    private void ValidateRequiredBy(DateOnly requiredBy)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        if (requiredBy < today)
            throw AppException.BadRequest("required_by_past", "The required-by date is in the past.");
    }

    private async Task ValidateLinesAsync(IReadOnlyList<SaveRequisitionLineRequest> lines, CancellationToken ct)
    {
        if (lines.Count == 0)
            throw AppException.BadRequest("no_lines", "Add at least one material.");

        var duplicate = lines.GroupBy(l => l.MaterialId).FirstOrDefault(g => g.Count() > 1);
        if (duplicate is not null)
            throw AppException.BadRequest("duplicate_material",
                "The same material appears twice. Put the whole quantity on one line.");

        foreach (var line in lines)
        {
            if (line.Quantity <= 0)
                throw AppException.BadRequest("invalid_quantity", "Every quantity must be more than zero.");
        }

        var ids = lines.Select(l => l.MaterialId).ToList();
        var found = await db.Materials.CountAsync(m => ids.Contains(m.Id) && m.IsActive, ct);

        if (found != ids.Count)
            throw AppException.BadRequest("unknown_material",
                "One of those materials no longer exists or has been retired.");
    }

    private static RequisitionPriority ParsePriority(string value) =>
        Enum.TryParse<RequisitionPriority>(value, true, out var priority)
            ? priority
            : RequisitionPriority.Normal;

    private static double? WaitingHours(Requisition r, DateTimeOffset now)
    {
        var since = r.Status switch
        {
            RequisitionStatus.Submitted => r.SubmittedAt,
            RequisitionStatus.Priced => r.PricedAt,
            _ => null,
        };
        return since is null ? null : Math.Round((now - since.Value).TotalHours, 1);
    }

    private async Task<RequisitionDetail> DescribeAsync(Requisition r, CancellationToken ct)
    {
        var seesPrices = me.Can(Permissions.PricesRead);

        var lastPaid = await LastPaidRatesAsync(r.Lines.Select(l => l.MaterialId).ToList(), ct);
        var cover = await CoverAsync(r, ct);

        var lines = r.Lines
            .OrderBy(l => l.Material.Category).ThenBy(l => l.Material.Name)
            .Select(l =>
            {
                lastPaid.TryGetValue(l.MaterialId, out var previous);

                return new RequisitionLineDto(
                    l.Id, l.MaterialId, l.Material.Code, l.Material.Name,
                    l.Material.Specification, l.Material.Unit.Code, l.Material.Unit.DecimalPlaces,
                    l.Material.RequiresCertificate,
                    l.Quantity, l.Notes,
                    // The awarded supplier stays: a supervisor has to know who is delivering
                    // in order to receive it. Everything with a rupee in it goes.
                    l.AwardedSupplierId, l.AwardedSupplier?.Name,
                    seesPrices ? l.UnitRate : null,
                    seesPrices ? l.TaxPercent : null,
                    seesPrices ? l.PricingNotes : null,
                    // Product code and make describe the goods, not the money, so a
                    // price-blind supervisor still sees which brand to expect at the gate.
                    l.ProductCode,
                    l.Make,
                    seesPrices ? l.ListRate : null,
                    seesPrices ? l.DiscountPercent : null,
                    seesPrices ? l.LineTotal : null,
                    seesPrices ? l.TaxAmount : null,
                    seesPrices ? l.LineTotalWithTax : null,
                    seesPrices ? previous?.Rate : null,
                    seesPrices ? previous?.On : null,
                    seesPrices ? previous?.SupplierName : null,
                    cover.TryGetValue(l.MaterialId, out var covered) ? covered : null,
                    l.AmendedAt, l.QuantityBefore,
                    seesPrices
                        ? l.Quotes
                            .OrderBy(q => q.UnitRate)
                            .Select(q => new QuoteDto(
                                q.Id, q.SupplierId, q.Supplier.Name, q.UnitRate, q.TaxPercent,
                                q.LeadTimeDays, q.Notes, l.Quantity * q.UnitRate,
                                q.SupplierId == l.AwardedSupplierId))
                            .ToList()
                        : []);
            })
            .ToList();

        var subTotal = lines.Sum(l => l.LineTotal ?? 0m);
        var taxTotal = lines.Sum(l => l.TaxAmount ?? 0m);

        BudgetSnapshot? budget = null;
        if (r.Status is RequisitionStatus.Priced or RequisitionStatus.Approved
            && (me.Can(Permissions.BudgetsRead) || me.Can(Permissions.PurchasesApprove)))
        {
            budget = await budgets.SnapshotAsync(r.SiteId, subTotal + taxTotal, ct);
        }

        var orderStatuses = r.PurchaseOrders.Select(o => o.Status).ToList();

        return new RequisitionDetail(
            r.Id, r.Number, r.SiteId, r.Site.Code, r.Site.Name,
            r.Status.ToString(), r.Priority.ToString(), r.RequiredBy, r.Notes,
            r.SupplierNote,
            r.SupplierTerms
                .Select(t => new SupplierTermDto(
                    t.SupplierId, t.Supplier.Name, t.PaymentTermsDays, t.Supplier.PaymentTermsDays))
                .ToList(),
            r.RequestedBy.FullName,
            r.WorkOrderId, r.WorkOrder?.Number, r.WorkOrder?.Title,
            r.PricedBy?.FullName, r.DecidedBy?.FullName, r.DecisionReason,
            r.CreatedAt, r.SubmittedAt, r.PricedAt, r.DecidedAt,
            seesPrices ? subTotal : null,
            seesPrices ? taxTotal : null,
            seesPrices ? subTotal + taxTotal : null,
            r.IsEditable && r.RequestedById == me.Id,
            // Anybody who works at the site and may raise a request can amend one. Not only
            // the raiser: he may be off site, and the alternative is a phone call the system
            // never hears about, which is the thing this feature exists to stop.
            Amendability.Blocker(r.Status, orderStatuses) is null
                && me.Can(Permissions.RequisitionsCreate) && me.CanSeeSite(r.SiteId),
            Amendability.WouldCancelOrders(r.Status, orderStatuses),
            r.AmendedAt, r.AmendedAfterPricingAt,
            r.Amendments
                .OrderByDescending(a => a.ChangedAt)
                .Select(a => new AmendmentDto(
                    a.Kind.ToString(), a.MaterialName, a.Before, a.After, a.Reason,
                    a.AfterPricing, a.ChangedBy.FullName, a.ChangedAt))
                .ToList(),
            lines,
            BuildTimeline(r),
            RequisitionStateMachine.AvailableActions(r, me).Select(a => a.ToString()).ToList(),
            budget,
            r.PurchaseOrders
                .OrderBy(o => o.Number)
                .Select(o => new PurchaseOrderSummary(
                    o.Id, o.Number, o.Supplier.Name, o.Status.ToString(),
                    seesPrices ? o.GrandTotal : null, o.ExpectedDelivery))
                .ToList());
    }

    private sealed record LastPaid(decimal Rate, DateTimeOffset On, string SupplierName);

    /// <summary>
    /// What each material last actually cost, from the most recent issued order. This is the
    /// number that makes quote comparison useful — a rate means little on its own, and a
    /// great deal next to what was paid last month.
    /// </summary>
    private async Task<Dictionary<Guid, LastPaid>> LastPaidRatesAsync(
        List<Guid> materialIds, CancellationToken ct)
    {
        if (materialIds.Count == 0) return [];

        var rows = await db.PurchaseOrderLines
            .AsNoTracking()
            .Where(l => materialIds.Contains(l.MaterialId))
            .OrderByDescending(l => l.PurchaseOrder.IssuedAt)
            .Select(l => new
            {
                l.MaterialId,
                l.UnitRate,
                l.PurchaseOrder.IssuedAt,
                SupplierName = l.PurchaseOrder.Supplier.Name,
            })
            .Take(400)
            .ToListAsync(ct);

        return rows
            .GroupBy(r => r.MaterialId)
            .ToDictionary(
                g => g.Key,
                g => new LastPaid(g.First().UnitRate, g.First().IssuedAt, g.First().SupplierName));
    }

    private static string DescribeAmendment(Domain.Procurement.RequisitionAmendment a) => a.Kind switch
    {
        AmendmentKind.LineAdded => $"added {a.MaterialName} ({a.After})",
        AmendmentKind.LineRemoved => $"removed {a.MaterialName}",
        AmendmentKind.QuantityChanged => $"{a.MaterialName} {a.Before} → {a.After}",
        AmendmentKind.LineNoteChanged => $"note on {a.MaterialName}",
        AmendmentKind.NeededByChanged => $"needed by {a.Before} → {a.After}",
        AmendmentKind.PriorityChanged => $"priority {a.Before} → {a.After}",
        _ => "note changed",
    };

    private static List<TimelineEntry> BuildTimeline(Requisition r)
    {
        var timeline = new List<TimelineEntry>
        {
            new("Raised", r.RequestedBy.FullName, r.CreatedAt, $"{r.Lines.Count} material(s)"),
        };

        if (r.SubmittedAt is not null)
            timeline.Add(new TimelineEntry("Submitted for pricing", r.RequestedBy.FullName, r.SubmittedAt, null));

        if (r.PricedAt is not null)
            timeline.Add(new TimelineEntry("Priced and awarded", r.PricedBy?.FullName, r.PricedAt, null));

        if (r.DecidedAt is not null)
        {
            // Worth stating plainly. In a company with one owner it is unavoidable and
            // usually fine — but somebody reading this in a year should not have to work
            // it out by comparing two names.
            var selfApproved = r.DecidedById is not null && r.DecidedById == r.RequestedById;

            var detail = selfApproved
                ? string.Join(" · ", new[]
                    {
                        "Raised and approved by the same person",
                        r.DecisionReason,
                    }.Where(part => !string.IsNullOrWhiteSpace(part)))
                : r.DecisionReason;

            timeline.Add(new TimelineEntry(
                r.Status == RequisitionStatus.Approved ? "Approved" : "Rejected",
                r.DecidedBy?.FullName, r.DecidedAt, detail,
                r.Status == RequisitionStatus.Rejected ? "bad" : "normal"));
        }

        // One timeline entry per amendment batch, not per field: a supervisor who changed
        // two quantities and the date in one go did one thing, and three rows would read as
        // three separate second thoughts.
        foreach (var batch in r.Amendments.GroupBy(a => a.ChangedAt))
        {
            var changes = batch.ToList();
            var detail = string.Join(", ", changes.Select(DescribeAmendment));

            timeline.Add(new TimelineEntry(
                changes[0].AfterPricing ? "Changed by the site after pricing" : "Changed by the site",
                changes[0].ChangedBy.FullName, batch.Key,
                $"{detail} — \"{changes[0].Reason}\"",
                changes[0].AfterPricing ? "warn" : "normal"));
        }

        foreach (var order in r.PurchaseOrders.OrderBy(o => o.Number))
        {
            timeline.Add(new TimelineEntry(
                $"Order {order.Number} issued", null, order.IssuedAt, order.Supplier.Name));

            // An order that was withdrawn has to say so here too. Without it the history
            // reads as two live orders against one request, and somebody chases a supplier
            // about a lorry that was never coming.
            if (order.CancelledAt is { } cancelledAt)
            {
                timeline.Add(new TimelineEntry(
                    $"Order {order.Number} cancelled",
                    order.CancelledBy?.FullName,
                    cancelledAt,
                    order.CancellationReason,
                    "bad"));
            }
        }

        return timeline.OrderBy(t => t.At).ToList();
    }
}
