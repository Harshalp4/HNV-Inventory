using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Identity;

namespace SiteStock.Api.Domain.Procurement;

/// <summary>
/// A change made to an order after it was raised — the date, the credit, or the note.
///
/// <para>Orders get changed. The buyer rings the supplier and pushes the delivery by five
/// days, or settles sixty days' credit instead of thirty. Refusing that would only mean the
/// real terms live on somebody's phone while the system shows something else.</para>
///
/// <para>So the change is allowed and recorded instead. Every row names who made it, when,
/// what it was before and what it became — and, once the supplier has been sent the order, a
/// reason, because at that point somebody has to be told and the record has to say what they
/// were told.</para>
/// </summary>
public class PurchaseOrderChange : AuditableEntity
{
    public Guid PurchaseOrderId { get; set; }
    public PurchaseOrder PurchaseOrder { get; set; } = null!;

    /// <summary>What changed, in words: "Delivery 20 Sep → 25 Sep · Credit 30 → 60 days".</summary>
    public string Summary { get; set; } = string.Empty;

    /// <summary>Why. Required once the order has gone out; optional before that.</summary>
    public string? Reason { get; set; }

    public DateTimeOffset ChangedAt { get; set; }

    public Guid ChangedById { get; set; }
    public User ChangedBy { get; set; } = null!;

    /// <summary>
    /// Whether the supplier already held a copy when this was changed. Drives the warning
    /// that their copy is now out of date and the order needs sending again.
    /// </summary>
    public bool AfterSending { get; set; }
}
