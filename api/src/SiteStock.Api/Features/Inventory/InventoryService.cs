using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Domain.Notifications;
using SiteStock.Api.Features.Notifications;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Inventory;

public record RecordConsumptionRequest(
    Guid SiteId, Guid MaterialId, decimal Quantity, DateOnly UsedOn, string? WorkArea, string? Notes);

public record SaveStockSettingRequest(
    Guid SiteId, Guid MaterialId, decimal ReorderLevel, decimal? ReorderQuantity, bool AlertsEnabled);

public record AdjustStockRequest(
    Guid SiteId, Guid MaterialId, decimal CountedQuantity,
    /// <summary>The coded reason. Free text alone cannot be counted at the end of the year.</summary>
    string ReasonCode,
    /// <summary>What actually happened, in words. Still required — the code is not the story.</summary>
    string Reason);

public record ConsumptionListItem(
    Guid Id, Guid MaterialId, string MaterialName, string UnitCode, int UnitDecimalPlaces,
    decimal Quantity, DateOnly UsedOn, string? WorkArea, string? Notes, string RecordedByName);

/// <summary>A site other than the one on screen that is holding stock right now.</summary>
public record StockElsewhere(Guid SiteId, string SiteCode, string SiteName, int MaterialCount);

public record MovementDto(
    long Id, string Type, decimal Quantity, string? SourceReference,
    DateTimeOffset OccurredAt, string RecordedByName, string? Notes, decimal RunningBalance);

public sealed class InventoryService(
    SiteStockDbContext db,
    StockLedger ledger,
    NotificationService notifications,
    ICurrentUser me,
    TimeProvider clock)
{
    public async Task<IReadOnlyList<StockOnHand>> StockAsync(
        Guid siteId, bool onlyLow, CancellationToken ct)
    {
        EnsureSite(siteId);
        return await ledger.ListAsync(siteId, onlyLow, ct);
    }

    /// <summary>
    /// Which <i>other</i> sites this person can see are holding stock.
    ///
    /// <para>An empty stock screen is ambiguous: it means either "nothing has ever been
    /// taken in" or "you are looking at the wrong site". Those need opposite responses, and
    /// the screen cannot tell them apart on its own. Deliveries is not scoped to the chosen
    /// site, so it is entirely normal to accept goods into MLCP while the toolbar says
    /// Belvedere B — and then find an empty shelf that is telling the truth.</para>
    ///
    /// <para>Counts of materials, not quantities or money: this is a signpost, not a report,
    /// and it must not become a way to read another site's holdings from outside it.</para>
    /// </summary>
    public async Task<IReadOnlyList<StockElsewhere>> ElsewhereAsync(
        Guid siteId, CancellationToken ct)
    {
        EnsureSite(siteId);

        var query = db.StockMovements.Where(m => m.SiteId != siteId);

        // Whether somebody sees every site is its own claim. An empty site list is a person
        // posted to no sites at all, and must narrow this to nothing rather than open it up.
        if (!me.HasAllSites)
        {
            var permitted = me.SiteIds.ToList();
            query = query.Where(m => permitted.Contains(m.SiteId));
        }

        var rows = await query
            .GroupBy(m => new { m.SiteId, m.MaterialId })
            .Select(g => new { g.Key.SiteId, g.Key.MaterialId, Quantity = g.Sum(m => m.Quantity) })
            .ToListAsync(ct);

        // Only what is actually on a shelf. A material issued back down to nothing has a
        // row in the ledger but no stock, and pointing somebody at it wastes the trip.
        var holding = rows
            .Where(r => r.Quantity > 0)
            .GroupBy(r => r.SiteId)
            .ToDictionary(g => g.Key, g => g.Count());

        if (holding.Count == 0) return [];

        var sites = await db.Sites
            .Where(s => holding.Keys.Contains(s.Id))
            .Select(s => new { s.Id, s.Code, s.Name })
            .ToListAsync(ct);

        return sites
            .Select(s => new StockElsewhere(s.Id, s.Code, s.Name, holding[s.Id]))
            .OrderByDescending(s => s.MaterialCount)
            .ThenBy(s => s.SiteName)
            .ToList();
    }

    /// <summary>
    /// The ledger for one material, most recent first, with a running balance so the
    /// question "why does the cement count look wrong" has a readable answer.
    /// </summary>
    public async Task<IReadOnlyList<MovementDto>> HistoryAsync(
        Guid siteId, Guid materialId, CancellationToken ct)
    {
        EnsureSite(siteId);

        var movements = await ledger.HistoryAsync(siteId, materialId, 200, ct);
        var balance = await ledger.OnHandAsync(siteId, materialId, ct);

        var result = new List<MovementDto>(movements.Count);

        foreach (var movement in movements)
        {
            result.Add(new MovementDto(
                movement.Id, movement.Type.ToString(), movement.Quantity, movement.SourceReference,
                movement.OccurredAt, movement.RecordedBy.FullName, movement.Notes, balance));

            // Walking backwards through history, so undo each movement to get the balance
            // as it stood before it.
            balance -= movement.Quantity;
        }

        return result;
    }

    /// <summary>
    /// Records what was used. The rule the specification is emphatic about lives here:
    /// <b>you cannot consume more than is on hand</b>. Negative stock is not a state a
    /// physical site can be in, and allowing it would make every downstream figure a guess.
    /// </summary>
    public async Task<ConsumptionListItem> RecordConsumptionAsync(
        RecordConsumptionRequest request, CancellationToken ct)
    {
        EnsureSite(request.SiteId);

        if (request.Quantity <= 0)
            throw AppException.BadRequest("invalid_quantity", "How much was used? It must be more than zero.");

        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        if (request.UsedOn > today)
            throw AppException.BadRequest("future_date", "You cannot record material used on a future date.");

        var material = await db.Materials.Include(m => m.Unit)
            .FirstOrDefaultAsync(m => m.Id == request.MaterialId, ct)
            ?? throw AppException.NotFound("That material");

        var onHand = await ledger.OnHandAsync(request.SiteId, request.MaterialId, ct);

        if (request.Quantity > onHand)
        {
            throw AppException.BadRequest("insufficient_stock",
                $"Only {Trim(onHand)} {material.Unit.Code} of {material.Name} is on hand, " +
                $"and you have entered {Trim(request.Quantity)}. If the count is wrong, " +
                "record a stock adjustment first — do not force the usage through.");
        }

        var now = clock.GetUtcNow();

        var record = new ConsumptionRecord
        {
            SiteId = request.SiteId,
            MaterialId = request.MaterialId,
            Quantity = request.Quantity,
            UsedOn = request.UsedOn,
            WorkArea = request.WorkArea?.Trim(),
            Notes = request.Notes?.Trim(),
            RecordedById = me.Id,
        };

        db.ConsumptionRecords.Add(record);

        // Negative: consumption takes stock out. The sign convention lives in the ledger.
        ledger.Append(
            request.SiteId, request.MaterialId, MovementType.Consumed, -request.Quantity,
            nameof(ConsumptionRecord), record.Id, null, me.Id, now, request.WorkArea?.Trim());

        await db.SaveChangesAsync(ct);

        return new ConsumptionListItem(
            record.Id, material.Id, material.Name, material.Unit.Code, material.Unit.DecimalPlaces,
            record.Quantity, record.UsedOn, record.WorkArea, record.Notes, me.FullName);
    }

    public async Task<IReadOnlyList<ConsumptionListItem>> ListConsumptionAsync(
        Guid siteId, int days, CancellationToken ct)
    {
        EnsureSite(siteId);

        var from = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime.AddDays(-Math.Abs(days)));

        return await db.ConsumptionRecords.AsNoTracking()
            .Include(c => c.Material).ThenInclude(m => m.Unit)
            .Include(c => c.RecordedBy)
            .Where(c => c.SiteId == siteId && c.UsedOn >= from)
            .OrderByDescending(c => c.UsedOn).ThenByDescending(c => c.CreatedAt)
            .Select(c => new ConsumptionListItem(
                c.Id, c.MaterialId, c.Material.Name, c.Material.Unit.Code, c.Material.Unit.DecimalPlaces,
                c.Quantity, c.UsedOn, c.WorkArea, c.Notes, c.RecordedBy.FullName))
            .ToListAsync(ct);
    }

    public async Task<StockOnHand> SaveStockSettingAsync(
        SaveStockSettingRequest request, CancellationToken ct)
    {
        EnsureSite(request.SiteId);

        if (request.ReorderLevel < 0)
            throw AppException.BadRequest("invalid_level", "A warn-me level cannot be negative.");

        var setting = await db.StockSettings
            .FirstOrDefaultAsync(s => s.SiteId == request.SiteId && s.MaterialId == request.MaterialId, ct);

        if (setting is null)
        {
            setting = new StockSetting { SiteId = request.SiteId, MaterialId = request.MaterialId };
            db.StockSettings.Add(setting);
        }

        setting.ReorderLevel = request.ReorderLevel;
        setting.ReorderQuantity = request.ReorderQuantity;
        setting.AlertsEnabled = request.AlertsEnabled;

        await db.SaveChangesAsync(ct);

        var stock = await ledger.ListAsync(request.SiteId, false, ct);
        return stock.First(s => s.MaterialId == request.MaterialId);
    }

    /// <summary>
    /// Corrects the books to a physical count. Always a new ledger row for the difference,
    /// never an edit of history — "the count was wrong" is itself a fact worth keeping.
    /// </summary>
    public async Task<StockOnHand> AdjustAsync(AdjustStockRequest request, CancellationToken ct)
    {
        EnsureSite(request.SiteId);

        if (string.IsNullOrWhiteSpace(request.Reason) || request.Reason.Trim().Length < 4)
            throw AppException.BadRequest("reason_required", "Say what happened. This is read at audit.");

        if (!Enum.TryParse<AdjustmentReason>(request.ReasonCode, ignoreCase: true, out var reason))
            throw AppException.BadRequest("bad_reason", "Pick why the count differs.");

        if (request.CountedQuantity < 0)
            throw AppException.BadRequest("invalid_quantity", "A physical count cannot be negative.");

        var onHand = await ledger.OnHandAsync(request.SiteId, request.MaterialId, ct);
        var difference = request.CountedQuantity - onHand;

        if (difference == 0)
            throw AppException.BadRequest("no_difference", "The count already matches the system. Nothing to adjust.");

        // Losing stock and finding it are not the same event, and a reason that says the
        // opposite of the arithmetic is worse than none — "stolen" against a count that went
        // up would sit in the theft total for the rest of the year.
        if (difference > 0 && reason is AdjustmentReason.Stolen or AdjustmentReason.Lost
                                   or AdjustmentReason.Damaged or AdjustmentReason.Wastage
                                   or AdjustmentReason.Expired)
        {
            throw AppException.BadRequest("reason_mismatch",
                $"The count went up by {Trim(difference)}, which is not something " +
                $"\"{Humanise(reason)}\" explains. Choose \"more was found\" or a keying error.");
        }

        if (difference < 0 && reason is AdjustmentReason.FoundExtra)
        {
            throw AppException.BadRequest("reason_mismatch",
                "The count went down, so \"more was found\" cannot be the reason.");
        }

        var material = await db.Materials.Include(m => m.Unit)
            .FirstOrDefaultAsync(m => m.Id == request.MaterialId, ct)
            ?? throw AppException.NotFound("That material");

        // Written off rather than merely adjusted, when somebody has named a cause. The type
        // is what makes "how much did we lose to theft this year" a query rather than a
        // reading exercise.
        var type = reason is AdjustmentReason.Stolen or AdjustmentReason.Lost
                          or AdjustmentReason.Damaged or AdjustmentReason.Expired
            ? MovementType.WrittenOff
            : MovementType.Adjustment;

        ledger.Append(
            request.SiteId, request.MaterialId, type, difference,
            "StockAdjustment", Guid.CreateVersion7(), null, me.Id, clock.GetUtcNow(),
            $"Counted {Trim(request.CountedQuantity)}, system said {Trim(onHand)}. {request.Reason.Trim()}",
            reason);

        await NotifyIfSeriousAsync(request.SiteId, material, reason, difference, request.Reason.Trim(), ct);

        await db.SaveChangesAsync(ct);

        var stock = await ledger.ListAsync(request.SiteId, false, ct);
        return stock.First(s => s.MaterialId == request.MaterialId);
    }

    /// <summary>
    /// Theft, loss and repeated unexplained shortfalls are told to the people who carry the
    /// cost. Not a block — a supervisor at the gate cannot wait for an approval to write off
    /// six broken bags — but never silent either, which is the failure mode that matters:
    /// stock quietly disappearing one correction at a time with nobody the wiser.
    /// </summary>
    private async Task NotifyIfSeriousAsync(
        Guid siteId, Domain.Catalog.Material material, AdjustmentReason reason,
        decimal difference, string detail, CancellationToken ct)
    {
        var serious = reason is AdjustmentReason.Stolen or AdjustmentReason.Lost
                             or AdjustmentReason.Unexplained;
        if (!serious || difference >= 0) return;

        var site = await db.Sites.AsNoTracking().FirstOrDefaultAsync(s => s.Id == siteId, ct);

        await notifications.RaiseForPermissionAsync(
            Permissions.PurchasesApprove, siteId,
            NotificationKind.StockWrittenOff,
            $"{Trim(Math.Abs(difference))} {material.Unit.Code} of {material.Name} written off as {Humanise(reason).ToLowerInvariant()}",
            $"{site?.Name} · {me.FullName} · \"{detail}\"",
            "/stock",
            reason == AdjustmentReason.Stolen ? NotificationUrgency.Urgent : NotificationUrgency.Normal,
            ct: ct);
    }

    private static string Humanise(AdjustmentReason reason) => reason switch
    {
        AdjustmentReason.Miscount => "Miscounted",
        AdjustmentReason.Damaged => "Damaged",
        AdjustmentReason.Lost => "Lost",
        AdjustmentReason.Stolen => "Stolen",
        AdjustmentReason.Wastage => "Wastage",
        AdjustmentReason.EntryError => "Keyed in wrong",
        AdjustmentReason.Expired => "Expired",
        AdjustmentReason.FoundExtra => "More was found",
        _ => "Unexplained",
    };

    private void EnsureSite(Guid siteId)
    {
        if (!me.CanSeeSite(siteId))
            throw AppException.Forbidden("You do not have access to that site.");
    }

    private static string Trim(decimal value) => value.ToString("0.###");
}
