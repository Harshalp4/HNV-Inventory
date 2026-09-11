using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Notifications;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Features.Notifications;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Requisitions;

public record AmendLine(Guid MaterialId, decimal Quantity, string? Notes);

public record AmendRequisitionRequest(
    IReadOnlyList<AmendLine> Lines,
    DateOnly RequiredBy,
    string Priority,
    string? Notes,
    /// <summary>Why the site changed it. Mandatory.</summary>
    string Reason);

/// <summary>
/// Changing a requisition that has already been sent on.
///
/// <para>The old rule was that lines are fixed once submitted, and the only way to change one
/// was to ask the purchase head to send it back. That is tidy and it is not what happens: the
/// slab grew, the site needs 60 bags rather than 40, and somebody rings the purchase head and
/// tells him. The change happens either way — the only question is whether the system knows
/// about it. So it is allowed, and every part of it is recorded.</para>
///
/// <para>Two things make it safe. Every change is a row naming who, when, from what, to what
/// and why. And a change that lands after somebody has priced it sends the requisition back
/// for re-pricing rather than leaving an owner to approve a total computed against quantities
/// that no longer exist — which is the failure this whole feature exists to prevent.</para>
/// </summary>
public sealed class RequisitionAmendmentService(
    SiteStockDbContext db,
    ICurrentUser me,
    TimeProvider clock,
    NotificationService notifications,
    ILogger<RequisitionAmendmentService> logger)
{
    public async Task<Requisition> AmendAsync(
        Guid id, AmendRequisitionRequest request, CancellationToken ct)
    {
        var requisition = await db.Requisitions
            .Include(r => r.Lines).ThenInclude(l => l.Material).ThenInclude(m => m.Unit)
            .Include(r => r.Site)
            .Include(r => r.RequestedBy)
            // Needed by the amendability rule: whether a supplier has been told is the thing
            // that closes a requisition, not whether the owner has approved it.
            .Include(r => r.PurchaseOrders)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == id, ct)
            ?? throw AppException.NotFound("That requisition");

        if (!me.CanSeeSite(requisition.SiteId))
            throw AppException.Forbidden("That requisition belongs to a site you do not work at.");

        var blocker = Amendability.Blocker(
            requisition.Status, requisition.PurchaseOrders.Select(o => o.Status));

        if (blocker is not null)
            throw AppException.BadRequest("not_amendable", blocker);

        var reason = request.Reason?.Trim();
        if (string.IsNullOrWhiteSpace(reason) || reason.Length < 4)
        {
            throw AppException.BadRequest("reason_required",
                "Say why it changed. Somebody has already worked on this, and they will want to know.");
        }

        if (request.Lines.Count == 0)
            throw AppException.BadRequest("no_lines", "A requisition needs at least one material. Cancel it instead.");

        var now = clock.GetUtcNow();
        var wasApproved = requisition.Status == RequisitionStatus.Approved;
        // An approved requisition has already been priced, so a change to it invalidates the
        // pricing exactly as a change to a priced one does.
        var wasPriced = requisition.Status is RequisitionStatus.Priced or RequisitionStatus.Approved;
        var amendments = new List<RequisitionAmendment>();

        // ── the header ───────────────────────────────────────────────────────
        if (requisition.RequiredBy != request.RequiredBy)
        {
            amendments.Add(Amendment(requisition, AmendmentKind.NeededByChanged, null, null,
                requisition.RequiredBy.ToString("d MMM"), request.RequiredBy.ToString("d MMM"),
                reason, wasPriced, now));
            requisition.RequiredBy = request.RequiredBy;
        }

        var priority = Enum.Parse<RequisitionPriority>(request.Priority, ignoreCase: true);
        if (requisition.Priority != priority)
        {
            amendments.Add(Amendment(requisition, AmendmentKind.PriorityChanged, null, null,
                requisition.Priority.ToString(), priority.ToString(), reason, wasPriced, now));
            requisition.Priority = priority;
        }

        var notes = request.Notes?.Trim();
        if ((requisition.Notes ?? string.Empty) != (notes ?? string.Empty))
        {
            amendments.Add(Amendment(requisition, AmendmentKind.NoteChanged, null, null,
                requisition.Notes, notes, reason, wasPriced, now));
            requisition.Notes = notes;
        }

        // ── the lines ────────────────────────────────────────────────────────
        var materials = await db.Materials.Include(m => m.Unit)
            .Where(m => request.Lines.Select(l => l.MaterialId).Contains(m.Id))
            .ToDictionaryAsync(m => m.Id, ct);

        foreach (var wanted in request.Lines)
        {
            if (!materials.ContainsKey(wanted.MaterialId))
                throw AppException.NotFound("One of those materials");

            if (wanted.Quantity <= 0)
                throw AppException.BadRequest("bad_quantity", "Every line needs a quantity above zero.");
        }

        var existing = requisition.Lines.ToDictionary(l => l.MaterialId);
        var kept = new HashSet<Guid>();

        foreach (var wanted in request.Lines)
        {
            var material = materials[wanted.MaterialId];
            kept.Add(wanted.MaterialId);

            if (existing.TryGetValue(wanted.MaterialId, out var line))
            {
                if (line.Quantity != wanted.Quantity)
                {
                    amendments.Add(Amendment(requisition, AmendmentKind.QuantityChanged,
                        material.Id, material.Name,
                        $"{Trim(line.Quantity)} {material.Unit.Code}",
                        $"{Trim(wanted.Quantity)} {material.Unit.Code}",
                        reason, wasPriced, now));

                    line.QuantityBefore = line.Quantity;
                    line.Quantity = wanted.Quantity;
                    line.AmendedAt = now;
                }

                var lineNotes = wanted.Notes?.Trim();
                if ((line.Notes ?? string.Empty) != (lineNotes ?? string.Empty))
                {
                    amendments.Add(Amendment(requisition, AmendmentKind.LineNoteChanged,
                        material.Id, material.Name, line.Notes, lineNotes, reason, wasPriced, now));
                    line.Notes = lineNotes;
                    line.AmendedAt = now;
                }
            }
            else
            {
                amendments.Add(Amendment(requisition, AmendmentKind.LineAdded,
                    material.Id, material.Name, null,
                    $"{Trim(wanted.Quantity)} {material.Unit.Code}", reason, wasPriced, now));

                // Through the DbSet, not the navigation: our keys are assigned on construction,
                // and EF reads a non-default key on a child of a tracked parent as "existing".
                db.RequisitionLines.Add(new RequisitionLine
                {
                    RequisitionId = requisition.Id,
                    MaterialId = wanted.MaterialId,
                    Quantity = wanted.Quantity,
                    Notes = wanted.Notes?.Trim(),
                    AmendedAt = now,
                });
            }
        }

        foreach (var line in requisition.Lines.Where(l => !kept.Contains(l.MaterialId)).ToList())
        {
            amendments.Add(Amendment(requisition, AmendmentKind.LineRemoved,
                line.MaterialId, line.Material.Name,
                $"{Trim(line.Quantity)} {line.Material.Unit.Code}", null, reason, wasPriced, now));

            db.RequisitionLines.Remove(line);
            requisition.Lines.Remove(line);
        }

        if (amendments.Count == 0)
        {
            throw AppException.BadRequest("nothing_changed",
                "Nothing is different from what was already sent, so there is nothing to record.");
        }

        // ── what it does to the workflow ─────────────────────────────────────
        requisition.AmendedAt = now;

        if (wasPriced)
        {
            // Back for re-pricing. The rates already captured are kept — the purchase head
            // should not retype six quotes because one quantity moved — but the "priced"
            // stamp goes, so nobody can approve a total that was worked out against the
            // quantities this amendment just replaced.
            requisition.AmendedAfterPricingAt = now;
            requisition.Status = RequisitionStatus.Submitted;
            requisition.PricedAt = null;
            requisition.PricedById = null;
        }

        var cancelled = new List<string>();

        if (wasApproved)
        {
            // The approval went with it. An owner who approved these lines has not approved
            // whatever replaced them, so the decision is cleared and the orders raised off
            // the back of it are withdrawn. Only unsent ones can be here — anything already
            // with a supplier was refused by the amendability rule above.
            requisition.DecidedAt = null;
            requisition.DecidedById = null;
            requisition.DecisionReason = null;

            foreach (var order in requisition.PurchaseOrders
                         .Where(o => o.Status == PurchaseOrderStatus.Issued))
            {
                order.Status = PurchaseOrderStatus.Cancelled;
                order.CancelledAt = now;
                order.CancelledById = me.Id;
                order.CancellationReason =
                    $"The site amended {requisition.Number} before this order was sent. \"{reason}\"";
                cancelled.Add(order.Number);
            }
        }

        foreach (var amendment in amendments) db.RequisitionAmendments.Add(amendment);

        await NotifyAsync(requisition, amendments, wasPriced, cancelled, ct);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "{Actor} amended {Requisition} with {Count} change(s){Repricing}{Cancelled}",
            me.FullName, requisition.Number, amendments.Count,
            wasPriced ? " — sent back for re-pricing" : string.Empty,
            cancelled.Count > 0 ? $" — cancelled {string.Join(", ", cancelled)}" : string.Empty);

        return requisition;
    }

    private async Task NotifyAsync(
        Requisition requisition, List<RequisitionAmendment> amendments, bool wasPriced,
        IReadOnlyCollection<string> cancelled, CancellationToken ct)
    {
        var summary = string.Join(", ", amendments.Take(3).Select(Describe));
        if (amendments.Count > 3) summary += $" and {amendments.Count - 3} more";

        var recipients = await notifications.RecipientsAsync(
            Permissions.RequisitionsPrice, requisition.SiteId, ct);

        // Whoever priced it is the person whose work just became stale, whether or not they
        // are still the one who would pick it up.
        if (wasPriced && requisition.PricedById is { } pricedBy && !recipients.Contains(pricedBy))
            recipients.Add(pricedBy);

        notifications.Raise(recipients,
            wasPriced ? NotificationKind.RequisitionSentBack : NotificationKind.RequisitionSubmitted,
            wasPriced
                ? $"{requisition.Number} changed after you priced it"
                : $"{requisition.Number} was changed by the site",
            cancelled.Count > 0
                ? $"{requisition.Site.Name} · {summary}. \"{amendments[0].Reason}\" — "
                  + $"{string.Join(" and ", cancelled)} cancelled, price it again."
                : $"{requisition.Site.Name} · {summary}. \"{amendments[0].Reason}\"",
            $"/requisitions/{requisition.Id}",
            requisition.SiteId,
            wasPriced ? NotificationUrgency.Urgent : NotificationUrgency.Normal);

        if (wasPriced)
        {
            var owners = await notifications.RecipientsAsync(
                Permissions.PurchasesApprove, requisition.SiteId, ct);

            notifications.Raise(owners,
                NotificationKind.RequisitionSentBack,
                cancelled.Count > 0
                    ? $"{requisition.Number} needs approving again"
                    : $"{requisition.Number} is no longer waiting for you",
                cancelled.Count > 0
                    ? $"The site changed it after you approved it. {string.Join(" and ", cancelled)} "
                      + "had not gone to the supplier, so they were cancelled and it is being priced again."
                    : "The site changed it after it was priced, so it has gone back to the purchase head.",
                $"/requisitions/{requisition.Id}", requisition.SiteId);
        }
    }

    private static string Describe(RequisitionAmendment a) => a.Kind switch
    {
        AmendmentKind.LineAdded => $"added {a.MaterialName}",
        AmendmentKind.LineRemoved => $"removed {a.MaterialName}",
        AmendmentKind.QuantityChanged => $"{a.MaterialName} {a.Before} → {a.After}",
        AmendmentKind.LineNoteChanged => $"note on {a.MaterialName}",
        AmendmentKind.NeededByChanged => $"needed by {a.Before} → {a.After}",
        AmendmentKind.PriorityChanged => $"priority {a.Before} → {a.After}",
        _ => "note changed",
    };

    private RequisitionAmendment Amendment(
        Requisition requisition, AmendmentKind kind, Guid? materialId, string? materialName,
        string? before, string? after, string reason, bool afterPricing, DateTimeOffset now) => new()
    {
        RequisitionId = requisition.Id,
        Kind = kind,
        MaterialId = materialId,
        MaterialName = materialName,
        Before = before,
        After = after,
        Reason = reason,
        AfterPricing = afterPricing,
        ChangedById = me.Id,
        ChangedAt = now,
    };

    private static string Trim(decimal value) => value.ToString("0.###");
}
