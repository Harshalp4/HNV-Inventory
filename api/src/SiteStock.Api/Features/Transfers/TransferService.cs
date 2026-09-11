using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Domain.Notifications;
using SiteStock.Api.Features.Inventory;
using SiteStock.Api.Features.Notifications;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Transfers;

public sealed class TransferService(
    SiteStockDbContext db,
    DocumentNumberService numbers,
    StockLedger ledger,
    NotificationService notifications,
    ICurrentUser me,
    TimeProvider clock,
    ILogger<TransferService> logger)
{
    // ── finding it elsewhere ─────────────────────────────────────────────────

    /// <summary>
    /// What other sites could genuinely let go of.
    ///
    /// <para>The word that matters is <b>spare</b>. A site with 40 bags and a warn-me level
    /// of 30 has ten to give, not forty. Offering the full figure would solve one site's
    /// problem by creating another's, and after that happens twice nobody trusts the screen.</para>
    /// </summary>
    public async Task<IReadOnlyList<SpareStockDto>> FindSpareAsync(
        Guid needingSiteId, Guid? materialId, CancellationToken ct)
    {
        if (!me.CanSeeSite(needingSiteId))
            throw AppException.Forbidden("You do not have access to that site.");

        // Only sites this person can actually see. A supervisor cannot go shopping through
        // the stock of a site he has no business knowing about.
        var otherSiteIds = await db.Sites.AsNoTracking()
            .Where(s => s.IsActive && s.Id != needingSiteId)
            .Select(s => s.Id)
            .ToListAsync(ct);

        otherSiteIds = otherSiteIds.Where(me.CanSeeSite).ToList();
        if (otherSiteIds.Count == 0) return [];

        var balances = await db.StockMovements.AsNoTracking()
            .Where(m => otherSiteIds.Contains(m.SiteId)
                        && (materialId == null || m.MaterialId == materialId))
            .GroupBy(m => new { m.SiteId, m.MaterialId })
            .Select(g => new { g.Key.SiteId, g.Key.MaterialId, Quantity = g.Sum(m => m.Quantity) })
            .Where(x => x.Quantity > 0)
            .ToListAsync(ct);

        if (balances.Count == 0) return [];

        var settings = await db.StockSettings.AsNoTracking()
            .Where(s => otherSiteIds.Contains(s.SiteId))
            .ToDictionaryAsync(s => (s.SiteId, s.MaterialId), s => s, ct);

        var materialIds = balances.Select(b => b.MaterialId).Distinct().ToList();

        var materials = await db.Materials.AsNoTracking().Include(m => m.Unit)
            .Where(m => materialIds.Contains(m.Id))
            .ToDictionaryAsync(m => m.Id, ct);

        var sites = await db.Sites.AsNoTracking()
            .Where(s => otherSiteIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, ct);

        var lastPaid = await LastPaidRatesAsync(materialIds, ct);

        var results = new List<SpareStockDto>();

        foreach (var balance in balances)
        {
            if (!materials.TryGetValue(balance.MaterialId, out var material)) continue;
            if (!sites.TryGetValue(balance.SiteId, out var site)) continue;

            settings.TryGetValue((balance.SiteId, balance.MaterialId), out var setting);

            var reorderLevel = setting?.ReorderLevel;
            var spare = Math.Max(0m, balance.Quantity - (reorderLevel ?? 0m));

            if (spare <= 0) continue;

            lastPaid.TryGetValue(balance.MaterialId, out var rate);

            results.Add(new SpareStockDto(
                site.Id, site.Code, site.Name,
                material.Id, material.Code, material.Name, material.Specification,
                material.Unit.Code, material.Unit.DecimalPlaces,
                balance.Quantity, reorderLevel, spare, rate,
                rate is { } r ? Math.Round(spare * r, 2) : 0m));
        }

        return results
            .OrderByDescending(r => r.AvoidedSpend)
            .ThenBy(r => r.MaterialName)
            .ToList();
    }

    // ── the workflow ─────────────────────────────────────────────────────────

    public async Task<TransferDetail> CreateAsync(CreateTransferRequest request, CancellationToken ct)
    {
        if (request.FromSiteId == request.ToSiteId)
            throw AppException.BadRequest("same_site", "That is the same site.");

        if (!me.CanSeeSite(request.ToSiteId))
            throw AppException.Forbidden("You cannot ask for material on behalf of that site.");

        if (!me.CanSeeSite(request.FromSiteId))
            throw AppException.Forbidden("You do not have access to the site you are asking.");

        if (request.Lines.Count == 0)
            throw AppException.BadRequest("no_lines", "Say what you need.");

        var duplicate = request.Lines.GroupBy(l => l.MaterialId).FirstOrDefault(g => g.Count() > 1);
        if (duplicate is not null)
            throw AppException.BadRequest("duplicate_material", "The same material appears twice.");

        var toSite = await db.Sites.FirstAsync(s => s.Id == request.ToSiteId, ct);
        var onHand = await ledger.OnHandAsync(
            request.FromSiteId, request.Lines.Select(l => l.MaterialId).ToList(), ct);

        var materials = await db.Materials.Include(m => m.Unit)
            .Where(m => request.Lines.Select(l => l.MaterialId).Contains(m.Id))
            .ToDictionaryAsync(m => m.Id, ct);

        foreach (var line in request.Lines)
        {
            if (line.Quantity <= 0)
                throw AppException.BadRequest("invalid_quantity", "Every quantity must be more than zero.");

            if (!materials.TryGetValue(line.MaterialId, out var material))
                throw AppException.NotFound("That material");

            onHand.TryGetValue(line.MaterialId, out var available);

            if (line.Quantity > available)
            {
                throw AppException.BadRequest("not_enough_there",
                    $"That site only has {available:0.###} {material.Unit.Code} of " +
                    $"{material.Name}, and you have asked for {line.Quantity:0.###}.");
            }
        }

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        var transfer = new TransferRequest
        {
            // Numbered against the site that needs it — that is who chases it.
            Number = await numbers.NextAsync("TRF", toSite.Code, ct),
            FromSiteId = request.FromSiteId,
            ToSiteId = request.ToSiteId,
            Status = TransferStatus.Requested,
            RequestedById = me.Id,
            NeededBy = request.NeededBy,
            Reason = request.Reason?.Trim(),
        };

        db.TransferRequests.Add(transfer);

        foreach (var line in request.Lines)
        {
            db.TransferLines.Add(new TransferLine
            {
                TransferRequestId = transfer.Id,
                MaterialId = line.MaterialId,
                RequestedQuantity = line.Quantity,
                Notes = line.Notes?.Trim(),
            });
        }

        await notifications.RaiseForPermissionAsync(
            Permissions.TransfersManage, transfer.FromSiteId,
            NotificationKind.TransferRequested,
            $"{toSite.Name} is asking for material",
            $"{transfer.Number} · {request.Lines.Count} material(s)" +
            (string.IsNullOrWhiteSpace(request.Reason) ? "" : $" · \"{request.Reason.Trim()}\""),
            $"/transfers/{transfer.Id}", NotificationUrgency.Normal, ct: ct);

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return await GetAsync(transfer.Id, ct);
    }

    /// <summary>
    /// The holding site answers. It may agree to less than was asked — which is the usual
    /// case, because the asking site cannot see what the holding site has already promised.
    /// </summary>
    public async Task<TransferDetail> DecideAsync(
        Guid id, DecideTransferRequest request, CancellationToken ct)
    {
        var transfer = await LoadAsync(id, ct);

        if (transfer.Status != TransferStatus.Requested)
        {
            throw AppException.BadRequest("already_decided",
                $"{transfer.Number} has already been {transfer.Status.ToString().ToLowerInvariant()}.");
        }

        // Only the site being asked gets to answer. Approving your own request would make
        // the whole conversation pointless.
        if (!me.CanSeeSite(transfer.FromSiteId))
            throw AppException.Forbidden("Only the site holding the material can answer this.");

        var now = clock.GetUtcNow();

        if (!request.Approve)
        {
            if (string.IsNullOrWhiteSpace(request.Notes))
            {
                throw AppException.BadRequest("reason_required",
                    "Say why you cannot spare it. The other site is deciding whether to buy instead.");
            }

            transfer.Status = TransferStatus.Declined;
            transfer.DecidedAt = now;
            transfer.DecidedById = me.Id;
            transfer.DecisionNotes = request.Notes.Trim();

            // They now have to decide whether to buy instead, so they need to know today.
            notifications.Raise(
                [transfer.RequestedById], NotificationKind.TransferAnswered,
                $"{transfer.FromSite.Name} cannot spare it",
                $"{transfer.Number} · {request.Notes.Trim()}",
                $"/transfers/{transfer.Id}", transfer.ToSiteId, NotificationUrgency.Normal);

            await db.SaveChangesAsync(ct);
            return await GetAsync(id, ct);
        }

        var byId = transfer.Lines.ToDictionary(l => l.Id);
        var onHand = await ledger.OnHandAsync(
            transfer.FromSiteId, transfer.Lines.Select(l => l.MaterialId).ToList(), ct);

        foreach (var line in transfer.Lines)
        {
            var approved = request.Lines?.FirstOrDefault(l => l.LineId == line.Id)?.Quantity
                           ?? line.RequestedQuantity;

            if (approved < 0)
                throw AppException.BadRequest("negative", "An agreed quantity cannot be negative.");

            onHand.TryGetValue(line.MaterialId, out var available);

            if (approved > available)
            {
                throw AppException.BadRequest("not_enough_there",
                    $"You only have {available:0.###} {line.Material.Unit.Code} of " +
                    $"{line.Material.Name} on the ground.");
            }

            line.ApprovedQuantity = approved;
        }

        if (transfer.Lines.All(l => (l.ApprovedQuantity ?? 0m) <= 0))
        {
            throw AppException.BadRequest("nothing_approved",
                "You have agreed to nothing. Decline it instead, with a reason.");
        }

        transfer.Status = TransferStatus.Approved;
        transfer.DecidedAt = now;
        transfer.DecidedById = me.Id;
        transfer.DecisionNotes = request.Notes?.Trim();

        notifications.Raise(
            [transfer.RequestedById], NotificationKind.TransferAnswered,
            $"{transfer.FromSite.Name} has agreed to send it",
            $"{transfer.Number} · {transfer.DecisionNotes ?? "Waiting to be sent."}",
            $"/transfers/{transfer.Id}", transfer.ToSiteId);

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    /// <summary>
    /// The lorry leaves. Stock comes out of the holding site now, because it physically has
    /// — not when it arrives at the far end. Anything else would show material in two places
    /// at once for however long the journey takes.
    /// </summary>
    public async Task<TransferDetail> DispatchAsync(
        Guid id, DispatchTransferRequest request, CancellationToken ct)
    {
        var transfer = await LoadAsync(id, ct);

        if (transfer.Status != TransferStatus.Approved)
        {
            throw AppException.BadRequest("not_approved",
                $"{transfer.Number} is {transfer.Status.ToString().ToLowerInvariant()} — " +
                "it can only be sent once the holding site has agreed.");
        }

        if (!me.CanSeeSite(transfer.FromSiteId))
            throw AppException.Forbidden("Only the site sending it can dispatch it.");

        var onHand = await ledger.OnHandAsync(
            transfer.FromSiteId, transfer.Lines.Select(l => l.MaterialId).ToList(), ct);

        var lastPaid = await LastPaidRatesAsync(transfer.Lines.Select(l => l.MaterialId).ToList(), ct);
        var now = clock.GetUtcNow();

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        foreach (var line in transfer.Lines)
        {
            var sent = request.Lines.FirstOrDefault(l => l.LineId == line.Id)?.Quantity
                       ?? line.ApprovedQuantity ?? 0m;

            if (sent < 0)
                throw AppException.BadRequest("negative", "A dispatched quantity cannot be negative.");

            if (sent > (line.ApprovedQuantity ?? 0m))
            {
                throw AppException.BadRequest("more_than_agreed",
                    $"You agreed to {line.ApprovedQuantity:0.###} {line.Material.Unit.Code} of " +
                    $"{line.Material.Name}, and are sending {sent:0.###}.");
            }

            onHand.TryGetValue(line.MaterialId, out var available);

            if (sent > available)
            {
                throw AppException.BadRequest("insufficient_stock",
                    $"Only {available:0.###} {line.Material.Unit.Code} of {line.Material.Name} " +
                    "is on the ground here now. Correct the count first.");
            }

            line.DispatchedQuantity = sent;
            line.UnitValue = lastPaid.GetValueOrDefault(line.MaterialId);

            if (sent > 0)
            {
                ledger.Append(
                    transfer.FromSiteId, line.MaterialId, MovementType.TransferOut, -sent,
                    nameof(TransferRequest), transfer.Id, transfer.Number, me.Id, now,
                    $"Sent to {transfer.ToSite.Name}");
            }
        }

        if (transfer.Lines.All(l => (l.DispatchedQuantity ?? 0m) <= 0))
            throw AppException.BadRequest("nothing_sent", "Nothing is being sent.");

        transfer.Status = TransferStatus.InTransit;
        transfer.DispatchedAt = now;
        transfer.DispatchedById = me.Id;
        transfer.VehicleNumber = request.VehicleNumber?.Trim().ToUpperInvariant();
        transfer.TransportCost = request.TransportCost;
        transfer.Notes = request.Notes?.Trim();

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        logger.LogInformation("{Number} dispatched from {From} to {To}",
            transfer.Number, transfer.FromSite.Name, transfer.ToSite.Name);

        await notifications.RaiseForPermissionAsync(
            Permissions.TransfersManage, transfer.ToSiteId,
            NotificationKind.TransferDispatched,
            $"Material is on its way from {transfer.FromSite.Name}",
            $"{transfer.Number}" +
            (string.IsNullOrWhiteSpace(transfer.VehicleNumber) ? "" : $" · {transfer.VehicleNumber}") +
            ". Count it in when it arrives.",
            $"/transfers/{transfer.Id}", NotificationUrgency.Normal, ct: ct);

        await db.SaveChangesAsync(ct);

        return await GetAsync(id, ct);
    }

    /// <summary>
    /// Counted in at the far end. Stock arrives now. A gap between sent and received is
    /// material that went missing on the road, and it stays visible rather than being
    /// quietly absorbed.
    /// </summary>
    public async Task<TransferDetail> ReceiveAsync(
        Guid id, ReceiveTransferRequest request, CancellationToken ct)
    {
        var transfer = await LoadAsync(id, ct);

        if (transfer.Status != TransferStatus.InTransit)
        {
            throw AppException.BadRequest("not_in_transit",
                $"{transfer.Number} is {transfer.Status.ToString().ToLowerInvariant()}.");
        }

        if (!me.CanSeeSite(transfer.ToSiteId))
            throw AppException.Forbidden("Only the receiving site can count it in.");

        var now = clock.GetUtcNow();

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        foreach (var line in transfer.Lines)
        {
            var received = request.Lines.FirstOrDefault(l => l.LineId == line.Id)?.Quantity
                           ?? line.DispatchedQuantity ?? 0m;

            if (received < 0)
                throw AppException.BadRequest("negative", "A received quantity cannot be negative.");

            if (received > (line.DispatchedQuantity ?? 0m))
            {
                throw AppException.BadRequest("more_than_sent",
                    $"{line.DispatchedQuantity:0.###} {line.Material.Unit.Code} of " +
                    $"{line.Material.Name} was sent, and you have counted {received:0.###}.");
            }

            line.ReceivedQuantity = received;
            line.Notes = request.Lines.FirstOrDefault(l => l.LineId == line.Id)?.Notes?.Trim() ?? line.Notes;

            if (received > 0)
            {
                ledger.Append(
                    transfer.ToSiteId, line.MaterialId, MovementType.TransferIn, received,
                    nameof(TransferRequest), transfer.Id, transfer.Number, me.Id, now,
                    $"From {transfer.FromSite.Name}");
            }

            // Short on arrival: the difference has already left the sending site's ledger,
            // so it is written off there rather than silently reappearing.
            var missing = (line.DispatchedQuantity ?? 0m) - received;

            if (missing > 0)
            {
                logger.LogWarning(
                    "{Number}: {Missing} {Unit} of {Material} did not arrive at {Site}",
                    transfer.Number, missing, line.Material.Unit.Code, line.Material.Name,
                    transfer.ToSite.Name);
            }
        }

        transfer.Status = TransferStatus.Received;
        transfer.ReceivedAt = now;
        transfer.ReceivedById = me.Id;

        if (!string.IsNullOrWhiteSpace(request.Notes))
            transfer.Notes = string.Join(" · ", new[] { transfer.Notes, request.Notes.Trim() }
                .Where(part => !string.IsNullOrWhiteSpace(part)));

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return await GetAsync(id, ct);
    }

    public async Task<TransferDetail> CancelAsync(Guid id, string? reason, CancellationToken ct)
    {
        var transfer = await LoadAsync(id, ct);

        if (transfer.Status is not (TransferStatus.Requested or TransferStatus.Approved))
        {
            throw AppException.BadRequest("cannot_cancel",
                transfer.Status == TransferStatus.InTransit
                    ? "It is already on a lorry. Count it in at the far end instead."
                    : $"{transfer.Number} is already {transfer.Status.ToString().ToLowerInvariant()}.");
        }

        if (transfer.RequestedById != me.Id && !me.CanSeeSite(transfer.ToSiteId))
            throw AppException.Forbidden("Only the site that asked can withdraw it.");

        transfer.Status = TransferStatus.Cancelled;
        transfer.DecisionNotes = reason?.Trim() ?? transfer.DecisionNotes;
        transfer.DecidedAt = clock.GetUtcNow();

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    // ── reading ──────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<TransferListItem>> ListAsync(
        Guid? siteId, string? status, bool onlyMine, CancellationToken ct)
    {
        var transfers = db.TransferRequests.AsNoTracking()
            .Include(t => t.FromSite).Include(t => t.ToSite)
            .Include(t => t.RequestedBy)
            .Include(t => t.Lines)
            .AsSplitQuery()
            .AsQueryable();

        if (siteId is { } id)
        {
            if (!me.CanSeeSite(id)) throw AppException.Forbidden("You do not have access to that site.");
            transfers = transfers.Where(t => t.FromSiteId == id || t.ToSiteId == id);
        }
        else if (!me.HasAllSites)
        {
            var permitted = me.SiteIds.ToList();
            transfers = transfers.Where(t =>
                permitted.Contains(t.FromSiteId) || permitted.Contains(t.ToSiteId));
        }

        if (!string.IsNullOrWhiteSpace(status)
            && Enum.TryParse<TransferStatus>(status, true, out var parsed))
        {
            transfers = transfers.Where(t => t.Status == parsed);
        }

        if (onlyMine)
        {
            // Waiting on an answer from a site I hold, or waiting to be counted in at one.
            transfers = transfers.Where(t =>
                t.Status == TransferStatus.Requested
                || t.Status == TransferStatus.Approved
                || t.Status == TransferStatus.InTransit);
        }

        var items = await transfers
            .OrderBy(t => t.Status)
            .ThenByDescending(t => t.CreatedAt)
            .ToListAsync(ct);

        return items.Select(t => new TransferListItem(
            t.Id, t.Number, t.Status.ToString(),
            t.FromSiteId, t.FromSite.Name, t.ToSiteId, t.ToSite.Name,
            t.RequestedBy.FullName, t.CreatedAt, t.NeededBy,
            t.Lines.Count, EstimateValue(t),
            NeedsMyAnswer(t))).ToList();
    }

    public async Task<TransferDetail> GetAsync(Guid id, CancellationToken ct) =>
        await DescribeAsync(await LoadAsync(id, ct), ct);

    // ── helpers ──────────────────────────────────────────────────────────────

    private async Task<TransferRequest> LoadAsync(Guid id, CancellationToken ct)
    {
        var transfer = await db.TransferRequests
            .Include(t => t.FromSite).Include(t => t.ToSite)
            .Include(t => t.RequestedBy).Include(t => t.DecidedBy)
            .Include(t => t.DispatchedBy).Include(t => t.ReceivedBy)
            .Include(t => t.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
            .AsSplitQuery()
            .FirstOrDefaultAsync(t => t.Id == id, ct)
            ?? throw AppException.NotFound("That transfer");

        // Either end is enough to see it — both sites are party to the conversation.
        if (!me.CanSeeSite(transfer.FromSiteId) && !me.CanSeeSite(transfer.ToSiteId))
            throw AppException.Forbidden("That transfer is between two sites you cannot see.");

        return transfer;
    }

    private bool NeedsMyAnswer(TransferRequest t) => t.Status switch
    {
        TransferStatus.Requested => me.CanSeeSite(t.FromSiteId),
        TransferStatus.Approved => me.CanSeeSite(t.FromSiteId),
        TransferStatus.InTransit => me.CanSeeSite(t.ToSiteId),
        _ => false,
    };

    private static decimal EstimateValue(TransferRequest t) =>
        t.Lines.Sum(l => (l.DispatchedQuantity ?? l.ApprovedQuantity ?? l.RequestedQuantity)
                         * (l.UnitValue ?? 0m));

    private async Task<Dictionary<Guid, decimal>> LastPaidRatesAsync(
        List<Guid> materialIds, CancellationToken ct)
    {
        if (materialIds.Count == 0) return [];

        var rows = await db.PurchaseOrderLines.AsNoTracking()
            .Where(l => materialIds.Contains(l.MaterialId))
            .OrderByDescending(l => l.PurchaseOrder.IssuedAt)
            .Select(l => new { l.MaterialId, l.UnitRate })
            .Take(400)
            .ToListAsync(ct);

        return rows.GroupBy(r => r.MaterialId)
            .ToDictionary(g => g.Key, g => g.First().UnitRate);
    }

    private async Task<TransferDetail> DescribeAsync(TransferRequest t, CancellationToken ct)
    {
        var available = await ledger.OnHandAsync(
            t.FromSiteId, t.Lines.Select(l => l.MaterialId).ToList(), ct);

        var lastPaid = await LastPaidRatesAsync(t.Lines.Select(l => l.MaterialId).ToList(), ct);

        var lines = t.Lines
            .OrderBy(l => l.Material.Category).ThenBy(l => l.Material.Name)
            .Select(l =>
            {
                available.TryGetValue(l.MaterialId, out var onHand);

                return new TransferLineDto(
                    l.Id, l.MaterialId, l.Material.Code, l.Material.Name, l.Material.Specification,
                    l.Material.Unit.Code, l.Material.Unit.DecimalPlaces,
                    l.RequestedQuantity, l.ApprovedQuantity, l.DispatchedQuantity, l.ReceivedQuantity,
                    l.UnitValue ?? lastPaid.GetValueOrDefault(l.MaterialId),
                    l.ShortfallQuantity, onHand, l.Notes);
            })
            .ToList();

        var value = lines.Sum(l =>
            (l.DispatchedQuantity ?? l.ApprovedQuantity ?? l.RequestedQuantity) * (l.UnitValue ?? 0m));

        var actions = new List<string>();

        if (me.Can(Permissions.TransfersManage))
        {
            switch (t.Status)
            {
                case TransferStatus.Requested when me.CanSeeSite(t.FromSiteId):
                    actions.Add("Decide");
                    break;
                case TransferStatus.Approved when me.CanSeeSite(t.FromSiteId):
                    actions.Add("Dispatch");
                    break;
                case TransferStatus.InTransit when me.CanSeeSite(t.ToSiteId):
                    actions.Add("Receive");
                    break;
            }

            if (t.Status is TransferStatus.Requested or TransferStatus.Approved
                && (t.RequestedById == me.Id || me.CanSeeSite(t.ToSiteId)))
            {
                actions.Add("Cancel");
            }
        }

        return new TransferDetail(
            t.Id, t.Number, t.Status.ToString(),
            t.FromSiteId, t.FromSite.Name, t.ToSiteId, t.ToSite.Name,
            t.RequestedBy.FullName, t.CreatedAt, t.NeededBy, t.Reason,
            t.DecidedBy?.FullName, t.DecidedAt, t.DecisionNotes,
            t.DispatchedBy?.FullName, t.DispatchedAt, t.VehicleNumber,
            t.ReceivedBy?.FullName, t.ReceivedAt,
            t.TransportCost, t.Notes,
            Math.Round(value, 2),
            Math.Round(value - (t.TransportCost ?? 0m), 2),
            lines, actions);
    }
}
