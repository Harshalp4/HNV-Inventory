using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Domain.Notifications;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Inventory;

public record SaveRecipientRequest(Guid SiteId, string Name, string? Trade, string? Contractor, string? PhoneNumber);

public record RecipientDto(
    Guid Id, string Name, string? Trade, string? Contractor, string? PhoneNumber, bool IsActive,
    /// <summary>How many returnable things this person still has. The reason to look.</summary>
    int OutstandingItems);

public record IssueLineRequest(Guid MaterialId, decimal Quantity, string? Notes);

public record IssueStockRequest(
    Guid SiteId, Guid RecipientId, DateOnly IssuedOn,
    string? WorkArea, string? Notes, IReadOnlyList<IssueLineRequest> Lines);

public record IssueLineDto(
    Guid Id, Guid MaterialId, string MaterialName, string UnitCode, int UnitDecimalPlaces,
    decimal Quantity, bool IsReturnable, decimal QuantityReturned, decimal Outstanding, string? Notes);

public record IssueDto(
    Guid Id, string Number, Guid SiteId, string SiteName,
    Guid RecipientId, string RecipientName, string? RecipientTrade,
    DateOnly IssuedOn, string? WorkArea, string? Notes, string IssuedByName,
    /// <summary>
    /// When it was actually entered, to the minute. <c>IssuedOn</c> is the day the material
    /// left the store, which somebody may back-date; this is the stamp on the record itself,
    /// and it is the one that settles an argument about who took what and when.
    /// </summary>
    DateTimeOffset RecordedAt,
    IReadOnlyList<IssueLineDto> Lines);

public record ReturnLineRequest(Guid IssueLineId, decimal Quantity);
public record ReturnStockRequest(IReadOnlyList<ReturnLineRequest> Lines, string? Notes);

public record WriteOffIssueRequest(Guid IssueLineId, decimal Quantity, string ReasonCode, string Reason);

public record OutstandingRow(
    Guid RecipientId, string RecipientName, string? Trade, string? Contractor, string? PhoneNumber,
    Guid IssueId, Guid IssueLineId, string IssueNumber, Guid MaterialId, string MaterialName, string UnitCode,
    int UnitDecimalPlaces, decimal Quantity, decimal Returned, decimal Outstanding,
    DateOnly IssuedOn, int DaysOut);

/// <summary>
/// Handing material out of the store, and getting it back.
///
/// <para>Stock comes off the moment it is recorded. There is no confirm step, because the
/// material has physically gone and a book that disagrees with the yard is worse than no
/// book at all.</para>
///
/// <para>What happens next depends on the material, not on whoever is at the store. Cement
/// handed to a mason is gone, and it is also written as consumption so that days-of-cover and
/// the usage report keep counting it — issuing to a person and using on site are the same
/// event seen from two ends, and two separate numbers for it would disagree within a week.
/// Shuttering plates handed to a gang are still the company's, and stay outstanding against
/// that person's name until somebody brings them back.</para>
/// </summary>
public sealed class StockIssueService(
    SiteStockDbContext db,
    StockLedger ledger,
    DocumentNumberService numbers,
    Notifications.NotificationService notifications,
    ICurrentUser me,
    TimeProvider clock)
{
    // ── who takes material ───────────────────────────────────────────────────

    public async Task<IReadOnlyList<RecipientDto>> ListRecipientsAsync(
        Guid siteId, bool includeInactive, CancellationToken ct)
    {
        EnsureSite(siteId);

        var recipients = await db.StockRecipients.AsNoTracking()
            .Where(r => r.SiteId == siteId && (includeInactive || r.IsActive))
            .OrderBy(r => r.Name)
            .ToListAsync(ct);

        var outstanding = await db.StockIssueLines.AsNoTracking()
            .Where(l => l.IsReturnable && l.QuantityReturned < l.Quantity
                     && l.StockIssue.SiteId == siteId)
            .GroupBy(l => l.StockIssue.RecipientId)
            .Select(g => new { RecipientId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.RecipientId, x => x.Count, ct);

        return recipients.Select(r => new RecipientDto(
            r.Id, r.Name, r.Trade, r.Contractor, r.PhoneNumber, r.IsActive,
            outstanding.GetValueOrDefault(r.Id))).ToList();
    }

    public async Task<RecipientDto> AddRecipientAsync(SaveRecipientRequest request, CancellationToken ct)
    {
        EnsureSite(request.SiteId);

        var name = request.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            throw AppException.BadRequest("name_required", "Give the person a name.");

        if (await db.StockRecipients.AnyAsync(r => r.SiteId == request.SiteId && r.Name == name, ct))
        {
            throw AppException.Conflict("name_in_use",
                $"{name} is already on the list for this site. Pick them rather than adding a second one — " +
                "two entries with one name is how \"who has the plates\" stops having an answer.");
        }

        var recipient = new StockRecipient
        {
            SiteId = request.SiteId,
            Name = name,
            Trade = request.Trade?.Trim(),
            Contractor = request.Contractor?.Trim(),
            PhoneNumber = request.PhoneNumber?.Trim(),
        };

        db.StockRecipients.Add(recipient);
        await db.SaveChangesAsync(ct);

        return new RecipientDto(recipient.Id, recipient.Name, recipient.Trade,
            recipient.Contractor, recipient.PhoneNumber, recipient.IsActive, 0);
    }

    // ── handing it out ───────────────────────────────────────────────────────

    public async Task<IssueDto> IssueAsync(IssueStockRequest request, CancellationToken ct)
    {
        EnsureSite(request.SiteId);

        if (request.Lines.Count == 0)
            throw AppException.BadRequest("no_lines", "Add at least one material.");

        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        if (request.IssuedOn > today)
            throw AppException.BadRequest("future_date", "You cannot hand out material on a future date.");

        var site = await db.Sites.FirstOrDefaultAsync(s => s.Id == request.SiteId, ct)
                   ?? throw AppException.NotFound("That site");

        var recipient = await db.StockRecipients
            .FirstOrDefaultAsync(r => r.Id == request.RecipientId && r.SiteId == request.SiteId, ct)
            ?? throw AppException.NotFound("That person");

        var materials = await db.Materials.Include(m => m.Unit)
            .Where(m => request.Lines.Select(l => l.MaterialId).Contains(m.Id))
            .ToDictionaryAsync(m => m.Id, ct);

        // Every quantity is checked against the ledger before anything is written. Handing
        // out more than is there is a counting mistake, and forcing it through would hide it.
        foreach (var line in request.Lines)
        {
            if (!materials.TryGetValue(line.MaterialId, out var material))
                throw AppException.NotFound("One of those materials");

            if (line.Quantity <= 0)
                throw AppException.BadRequest("bad_quantity", "Every line needs a quantity above zero.");

            var onHand = await ledger.OnHandAsync(request.SiteId, line.MaterialId, ct);
            if (line.Quantity > onHand)
            {
                throw AppException.BadRequest("insufficient_stock",
                    $"Only {Trim(onHand)} {material.Unit.Code} of {material.Name} is on hand, and you " +
                    $"have entered {Trim(line.Quantity)}. If the count is wrong, correct it first — " +
                    "do not force the issue through.");
            }
        }

        var now = clock.GetUtcNow();

        var issue = new StockIssue
        {
            Number = await numbers.NextAsync("ISS", site.Code, ct),
            SiteId = request.SiteId,
            RecipientId = recipient.Id,
            IssuedOn = request.IssuedOn,
            WorkArea = request.WorkArea?.Trim(),
            Notes = request.Notes?.Trim(),
            IssuedById = me.Id,
        };

        db.StockIssues.Add(issue);

        foreach (var line in request.Lines)
        {
            var material = materials[line.MaterialId];

            var issueLine = new StockIssueLine
            {
                StockIssueId = issue.Id,
                MaterialId = line.MaterialId,
                Quantity = line.Quantity,
                IsReturnable = material.IsReturnable,
                Notes = line.Notes?.Trim(),
            };

            db.StockIssueLines.Add(issueLine);

            ledger.Append(
                request.SiteId, line.MaterialId, MovementType.Issued, -line.Quantity,
                nameof(StockIssue), issue.Id, null, me.Id, now,
                $"To {recipient.Name}{(issue.WorkArea is null ? string.Empty : $" · {issue.WorkArea}")}");

            // A consumable handed to somebody is material used on site. Writing it as
            // consumption too keeps days-of-cover and the usage report counting it — the
            // alternative is two numbers for one event, which disagree within a week.
            if (!material.IsReturnable)
            {
                db.ConsumptionRecords.Add(new Domain.Inventory.ConsumptionRecord
                {
                    SiteId = request.SiteId,
                    MaterialId = line.MaterialId,
                    Quantity = line.Quantity,
                    UsedOn = request.IssuedOn,
                    WorkArea = issue.WorkArea,
                    Notes = $"Issued to {recipient.Name} on {issue.Number}",
                    RecordedById = me.Id,
                });
            }
        }

        await db.SaveChangesAsync(ct);
        return await DescribeAsync(issue.Id, ct);
    }

    // ── getting it back ──────────────────────────────────────────────────────

    public async Task<IssueDto> ReturnAsync(Guid issueId, ReturnStockRequest request, CancellationToken ct)
    {
        var issue = await db.StockIssues
            .Include(i => i.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
            .Include(i => i.Recipient)
            .FirstOrDefaultAsync(i => i.Id == issueId, ct)
            ?? throw AppException.NotFound("That issue");

        EnsureSite(issue.SiteId);

        var now = clock.GetUtcNow();
        var any = false;

        foreach (var wanted in request.Lines)
        {
            var line = issue.Lines.FirstOrDefault(l => l.Id == wanted.IssueLineId)
                       ?? throw AppException.NotFound("One of those lines");

            if (wanted.Quantity <= 0) continue;

            if (!line.IsReturnable)
            {
                throw AppException.BadRequest("not_returnable",
                    $"{line.Material.Name} was used, not borrowed — there is nothing to bring back. " +
                    "If it was recorded against the wrong person, correct the stock instead.");
            }

            var remaining = line.Quantity - line.QuantityReturned;
            if (wanted.Quantity > remaining)
            {
                throw AppException.BadRequest("too_much_returned",
                    $"Only {Trim(remaining)} {line.Material.Unit.Code} of {line.Material.Name} is " +
                    $"still out with {issue.Recipient.Name}.");
            }

            line.QuantityReturned += wanted.Quantity;
            any = true;

            ledger.Append(
                issue.SiteId, line.MaterialId, MovementType.ReturnedFromIssue, wanted.Quantity,
                nameof(StockIssue), issue.Id, null, me.Id, now,
                $"Back from {issue.Recipient.Name}");
        }

        if (!any)
            throw AppException.BadRequest("nothing_returned", "Enter how much has come back.");

        if (!string.IsNullOrWhiteSpace(request.Notes))
        {
            issue.Notes = string.IsNullOrWhiteSpace(issue.Notes)
                ? request.Notes.Trim()
                : $"{issue.Notes}\n{request.Notes.Trim()}";
        }

        await db.SaveChangesAsync(ct);
        return await DescribeAsync(issue.Id, ct);
    }

    /// <summary>
    /// It is not coming back — broken on site, lost, or taken.
    ///
    /// <para>Stock came off when it was handed over, so nothing moves here: what changes is
    /// that the line stops being outstanding, and a written-off movement of zero quantity
    /// records why. Adding a second negative movement would take the same plates off the
    /// books twice, and the count would be wrong in the direction nobody checks.</para>
    /// </summary>
    public async Task<IssueDto> WriteOffAsync(
        Guid issueId, WriteOffIssueRequest request, CancellationToken ct)
    {
        var issue = await db.StockIssues
            .Include(i => i.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
            .Include(i => i.Recipient)
            .Include(i => i.Site)
            .FirstOrDefaultAsync(i => i.Id == issueId, ct)
            ?? throw AppException.NotFound("That issue");

        EnsureSite(issue.SiteId);

        var detail = request.Reason?.Trim();
        if (string.IsNullOrWhiteSpace(detail) || detail.Length < 4)
            throw AppException.BadRequest("reason_required", "Say what happened to it.");

        if (!Enum.TryParse<AdjustmentReason>(request.ReasonCode, ignoreCase: true, out var reason)
            || reason is not (AdjustmentReason.Damaged or AdjustmentReason.Lost
                              or AdjustmentReason.Stolen or AdjustmentReason.Unexplained))
        {
            throw AppException.BadRequest("bad_reason",
                "Choose whether it was damaged, lost, taken, or cannot be accounted for.");
        }

        var line = issue.Lines.FirstOrDefault(l => l.Id == request.IssueLineId)
                   ?? throw AppException.NotFound("That line");

        if (!line.IsReturnable)
            throw AppException.BadRequest("not_returnable", "That was used, not borrowed.");

        var remaining = line.Quantity - line.QuantityReturned;
        if (request.Quantity <= 0 || request.Quantity > remaining)
        {
            throw AppException.BadRequest("bad_quantity",
                $"Only {Trim(remaining)} {line.Material.Unit.Code} is still out with {issue.Recipient.Name}.");
        }

        // Counted as settled so it leaves the outstanding list. It did not come back, and the
        // movement below is what says so.
        line.QuantityReturned += request.Quantity;

        ledger.Append(
            issue.SiteId, line.MaterialId, MovementType.WrittenOff, 0m,
            nameof(StockIssue), issue.Id, null, me.Id, clock.GetUtcNow(),
            $"{Trim(request.Quantity)} {line.Material.Unit.Code} out with {issue.Recipient.Name} " +
            $"on {issue.Number} written off. {detail}",
            reason);

        var urgent = reason == AdjustmentReason.Stolen;

        await notifications.RaiseForPermissionAsync(
            Permissions.PurchasesApprove, issue.SiteId,
            NotificationKind.StockWrittenOff,
            $"{Trim(request.Quantity)} {line.Material.Unit.Code} of {line.Material.Name} never came back",
            $"{issue.Site.Name} · out with {issue.Recipient.Name} · {reason} · \"{detail}\"",
            "/issues",
            urgent ? NotificationUrgency.Urgent : NotificationUrgency.Normal,
            ct: ct);

        await db.SaveChangesAsync(ct);
        return await DescribeAsync(issue.Id, ct);
    }

    // ── reading it back ──────────────────────────────────────────────────────

    /// <summary>Everything still out, oldest first — the list somebody chases.</summary>
    public async Task<IReadOnlyList<OutstandingRow>> OutstandingAsync(
        Guid siteId, Guid? recipientId, CancellationToken ct)
    {
        EnsureSite(siteId);

        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);

        var rows = await db.StockIssueLines.AsNoTracking()
            .Where(l => l.IsReturnable
                     && l.QuantityReturned < l.Quantity
                     && l.StockIssue.SiteId == siteId
                     && (recipientId == null || l.StockIssue.RecipientId == recipientId))
            .OrderBy(l => l.StockIssue.IssuedOn)
            .Select(l => new
            {
                l.StockIssue.RecipientId,
                l.StockIssue.Recipient.Name,
                l.StockIssue.Recipient.Trade,
                l.StockIssue.Recipient.Contractor,
                l.StockIssue.Recipient.PhoneNumber,
                IssueId = l.StockIssueId,
                LineId = l.Id,
                l.StockIssue.Number,
                l.MaterialId,
                MaterialName = l.Material.Name,
                UnitCode = l.Material.Unit.Code,
                Decimals = l.Material.Unit.DecimalPlaces,
                l.Quantity,
                l.QuantityReturned,
                l.StockIssue.IssuedOn,
            })
            .ToListAsync(ct);

        return rows.Select(r => new OutstandingRow(
            r.RecipientId, r.Name, r.Trade, r.Contractor, r.PhoneNumber,
            r.IssueId, r.LineId, r.Number, r.MaterialId, r.MaterialName, r.UnitCode, r.Decimals,
            r.Quantity, r.QuantityReturned, r.Quantity - r.QuantityReturned,
            r.IssuedOn, today.DayNumber - r.IssuedOn.DayNumber)).ToList();
    }

    public async Task<IReadOnlyList<IssueDto>> ListAsync(Guid siteId, int days, CancellationToken ct)
    {
        EnsureSite(siteId);

        var from = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime.AddDays(-Math.Abs(days)));

        var issues = await Queryable()
            .Where(i => i.SiteId == siteId && i.IssuedOn >= from)
            .OrderByDescending(i => i.IssuedOn).ThenByDescending(i => i.CreatedAt)
            .ToListAsync(ct);

        return issues.Select(Describe).ToList();
    }

    public async Task<IssueDto> DescribeAsync(Guid id, CancellationToken ct)
    {
        var issue = await Queryable().FirstOrDefaultAsync(i => i.Id == id, ct)
                    ?? throw AppException.NotFound("That issue");

        EnsureSite(issue.SiteId);
        return Describe(issue);
    }

    private IQueryable<StockIssue> Queryable() => db.StockIssues.AsNoTracking()
        .Include(i => i.Site)
        .Include(i => i.Recipient)
        .Include(i => i.IssuedBy)
        .Include(i => i.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
        .AsSplitQuery();

    private static IssueDto Describe(StockIssue i) => new(
        i.Id, i.Number, i.SiteId, i.Site.Name,
        i.RecipientId, i.Recipient.Name, i.Recipient.Trade,
        i.IssuedOn, i.WorkArea, i.Notes, i.IssuedBy.FullName, i.CreatedAt,
        i.Lines
            .OrderBy(l => l.Material.Name)
            .Select(l => new IssueLineDto(
                l.Id, l.MaterialId, l.Material.Name, l.Material.Unit.Code,
                l.Material.Unit.DecimalPlaces, l.Quantity, l.IsReturnable,
                l.QuantityReturned, l.Outstanding, l.Notes))
            .ToList());

    private void EnsureSite(Guid siteId)
    {
        if (!me.CanSeeSite(siteId))
            throw AppException.Forbidden("That site is not one you work at.");
    }

    private static string Trim(decimal value) => value.ToString("0.###");
}
