using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Reports;

/// <param name="Key">Stable id, so the client picks the icon and route rather than parsing text.</param>
public record ActivityCount(string Key, string Label, int Count, string? Route);

/// <param name="What">What they did, in the past tense, as somebody would say it aloud.</param>
public record ActivityEntry(
    DateTimeOffset At, string Kind, string What, string Reference,
    string? SiteName, string? Detail, string? Route);

public record PersonActivity(
    Guid UserId, string FullName, string? Email, string? PhoneNumber,
    IReadOnlyList<string> Roles, IReadOnlyList<string> Sites,
    DateOnly From, DateOnly To,
    IReadOnlyList<ActivityCount> Counts,
    IReadOnlyList<ActivityEntry> Timeline);

/// <summary>
/// What one person actually did, counted and listed.
///
/// <para>Built entirely from the records the workflow already writes — who raised a
/// requisition, who priced it, who sent an order, who counted a lorry in, who wrote stock
/// off. There is no separate activity log to fall out of step with the work, and nothing
/// here can say something happened that did not leave a document behind.</para>
///
/// <para>This is the answer to "how is Santosh doing" that does not depend on anybody's
/// memory, and to "who accepted that short delivery" months after the fact.</para>
/// </summary>
public sealed class PersonActivityService(SiteStockDbContext db, ICurrentUser me, TimeProvider clock)
{
    public async Task<PersonActivity> BuildAsync(
        Guid userId, DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        // Anybody may look at their own record. Looking at somebody else's is a management
        // act, so it needs the permission that already governs seeing the people list.
        if (userId != me.Id && !me.Can(Permissions.UsersRead))
            throw AppException.Forbidden("You can only look at your own record.");

        var end = to ?? DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var start = from ?? end.AddMonths(-3);
        var startAt = start.ToDateTime(TimeOnly.MinValue).ToUniversalTime();
        var endAt = end.AddDays(1).ToDateTime(TimeOnly.MinValue).ToUniversalTime();

        var person = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new
            {
                u.Id, u.FullName, u.Email, u.PhoneNumber,
                Roles = u.RoleAssignments.Select(r => r.Role.Name).Distinct().ToList(),
                Sites = u.RoleAssignments.Select(r => r.Site.Name).Distinct().ToList(),
            })
            .FirstOrDefaultAsync(ct)
            ?? throw AppException.NotFound("That person");

        var timeline = new List<ActivityEntry>();
        var counts = new List<ActivityCount>();

        // ── requisitions raised ──────────────────────────────────────────────
        var raised = await db.Requisitions.AsNoTracking()
            .Where(r => r.RequestedById == userId && r.CreatedAt >= startAt && r.CreatedAt < endAt)
            .Select(r => new { r.Id, r.Number, r.CreatedAt, Site = r.Site.Name, Lines = r.Lines.Count() })
            .ToListAsync(ct);

        counts.Add(new("raised", "Requests raised", raised.Count, "/requisitions"));
        timeline.AddRange(raised.Select(r => new ActivityEntry(
            r.CreatedAt, "raised", "Raised a request", r.Number, r.Site,
            $"{r.Lines} material(s)", $"/requisitions/{r.Id}")));

        // ── priced ───────────────────────────────────────────────────────────
        var priced = await db.Requisitions.AsNoTracking()
            .Where(r => r.PricedById == userId && r.PricedAt >= startAt && r.PricedAt < endAt)
            .Select(r => new { r.Id, r.Number, r.PricedAt, Site = r.Site.Name })
            .ToListAsync(ct);

        counts.Add(new("priced", "Requests priced", priced.Count, "/requisitions"));
        timeline.AddRange(priced.Select(r => new ActivityEntry(
            r.PricedAt!.Value, "priced", "Priced a request", r.Number, r.Site, null,
            $"/requisitions/{r.Id}")));

        // ── approved or rejected ─────────────────────────────────────────────
        var decided = await db.Requisitions.AsNoTracking()
            .Where(r => r.DecidedById == userId && r.DecidedAt >= startAt && r.DecidedAt < endAt)
            .Select(r => new { r.Id, r.Number, r.DecidedAt, r.Status, Site = r.Site.Name })
            .ToListAsync(ct);

        counts.Add(new("decided", "Requests decided", decided.Count, "/requisitions"));
        timeline.AddRange(decided.Select(r => new ActivityEntry(
            r.DecidedAt!.Value, "decided",
            r.Status == RequisitionStatus.Rejected ? "Rejected a request" : "Approved a request",
            r.Number, r.Site, null, $"/requisitions/{r.Id}")));

        // ── orders issued ────────────────────────────────────────────────────
        var issued = await db.PurchaseOrders.AsNoTracking()
            .Where(o => o.IssuedById == userId && o.IssuedAt >= startAt && o.IssuedAt < endAt)
            .Select(o => new { o.Id, o.Number, o.IssuedAt, Site = o.Site.Name, Supplier = o.Supplier.Name })
            .ToListAsync(ct);

        counts.Add(new("orders", "Purchase orders raised", issued.Count, "/purchase-orders"));
        timeline.AddRange(issued.Select(o => new ActivityEntry(
            o.IssuedAt, "order", "Raised a purchase order", o.Number, o.Site,
            $"to {o.Supplier}", $"/purchase-orders/{o.Id}")));

        // ── orders sent to a supplier ────────────────────────────────────────
        var sent = await db.PurchaseOrderCommunications.AsNoTracking()
            .Where(c => c.SentById == userId && c.SentAt >= startAt && c.SentAt < endAt)
            .Select(c => new
            {
                c.PurchaseOrderId, Number = c.PurchaseOrder.Number, c.SentAt,
                Site = c.PurchaseOrder.Site.Name, c.Channel, c.Recipient,
            })
            .ToListAsync(ct);

        counts.Add(new("sent", "Orders sent to suppliers", sent.Count, "/purchase-orders"));
        timeline.AddRange(sent.Select(c => new ActivityEntry(
            c.SentAt, "sent", "Sent an order to the supplier", c.Number, c.Site,
            $"by {Readable(c.Channel.ToString()).ToLowerInvariant()} to {c.Recipient}",
            $"/purchase-orders/{c.PurchaseOrderId}")));

        // ── deliveries counted in ────────────────────────────────────────────
        var received = await db.GoodsReceipts.AsNoTracking()
            .Where(g => g.ReceivedById == userId && g.ReceivedAt >= startAt && g.ReceivedAt < endAt)
            .Select(g => new
            {
                g.Id, g.Number, g.ReceivedAt, g.Status, Site = g.Site.Name,
                Supplier = g.PurchaseOrder.Supplier.Name,
                Short = g.Lines.Any(l => l.ReceivedQuantity < l.OrderedQuantity),
                Refused = g.Lines.Any(l => l.AcceptedQuantity < l.ReceivedQuantity),
            })
            .ToListAsync(ct);

        counts.Add(new("received", "Deliveries counted in", received.Count(g => g.Status == GoodsReceiptStatus.Accepted), "/deliveries"));

        var turnedAway = received.Count(g => g.Status == GoodsReceiptStatus.Rejected);
        if (turnedAway > 0)
            counts.Add(new("refused", "Loads turned away", turnedAway, "/deliveries"));

        timeline.AddRange(received.Select(g => new ActivityEntry(
            g.ReceivedAt, g.Status == GoodsReceiptStatus.Rejected ? "refused" : "received",
            g.Status switch
            {
                GoodsReceiptStatus.Rejected => "Refused a delivery",
                GoodsReceiptStatus.Accepted => "Counted a delivery in",
                _ => "Started counting a delivery",
            },
            g.Number, g.Site,
            g.Short || g.Refused
                ? $"from {g.Supplier} · {(g.Short ? "came short" : "part refused")}"
                : $"from {g.Supplier}",
            $"/deliveries/{g.Id}")));

        // ── stock written off or corrected ───────────────────────────────────
        var adjusted = await db.StockMovements.AsNoTracking()
            .Where(m => m.RecordedById == userId && m.OccurredAt >= startAt && m.OccurredAt < endAt)
            .Where(m => m.Type == MovementType.Adjustment || m.Type == MovementType.WrittenOff)
            .Select(m => new
            {
                m.OccurredAt, m.Quantity, m.Reason, Site = m.Site.Name,
                Material = m.Material.Name, Unit = m.Material.Unit.Code, m.Notes,
            })
            .ToListAsync(ct);

        counts.Add(new("adjusted", "Stock corrections and write-offs", adjusted.Count, "/stock"));
        timeline.AddRange(adjusted.Select(m => new ActivityEntry(
            m.OccurredAt, m.Quantity < 0 ? "written-off" : "adjusted",
            m.Quantity < 0 ? "Wrote stock off" : "Corrected a count",
            m.Material, m.Site,
            $"{Math.Abs(m.Quantity):0.###} {m.Unit}"
            + (m.Reason is null ? "" : $" · {Readable(m.Reason.ToString()!).ToLowerInvariant()}"),
            "/stock")));

        // ── handed out to labour ─────────────────────────────────────────────
        var issues = await db.StockIssues.AsNoTracking()
            .Where(i => i.IssuedById == userId && i.CreatedAt >= startAt && i.CreatedAt < endAt)
            .Select(i => new
            {
                i.Id, i.Number, i.CreatedAt, Site = i.Site.Name,
                To = i.Recipient.Name, Lines = i.Lines.Count(),
            })
            .ToListAsync(ct);

        counts.Add(new("issued", "Handovers to labour", issues.Count, "/handovers"));
        timeline.AddRange(issues.Select(i => new ActivityEntry(
            i.CreatedAt, "issued", "Handed material out", i.Number, i.Site,
            $"to {i.To} · {i.Lines} item(s)", $"/handovers/{i.Id}")));

        // ── money paid out ───────────────────────────────────────────────────
        if (me.Can(Permissions.PricesRead))
        {
            var payments = await db.SupplierPayments.AsNoTracking()
                .Where(p => p.RecordedById == userId && p.CreatedAt >= startAt && p.CreatedAt < endAt)
                .Select(p => new
                {
                    p.Id, p.InvoiceId, p.Amount, p.PaidOn, p.Method, p.CreatedAt,
                    Site = p.Site.Name, Supplier = p.Supplier.Name,
                    Bill = p.Invoice.SupplierInvoiceNumber,
                })
                .ToListAsync(ct);

            counts.Add(new("paid", "Payments recorded", payments.Count, "/invoices"));
            timeline.AddRange(payments.Select(p => new ActivityEntry(
                p.CreatedAt, "paid", "Recorded a payment", p.Bill, p.Site,
                $"₹{p.Amount:N0} to {p.Supplier} by {Readable(p.Method.ToString()).ToLowerInvariant()}",
                $"/invoices/{p.InvoiceId}")));
        }

        return new PersonActivity(
            person.Id, person.FullName, person.Email, person.PhoneNumber,
            person.Roles, person.Sites, start, end,
            counts.Where(c => c.Count > 0).ToList(),
            timeline.OrderByDescending(e => e.At).Take(200).ToList());
    }

    private static string Readable(string value) =>
        System.Text.RegularExpressions.Regex.Replace(value, "([a-z])([A-Z])", "$1 $2");
}
