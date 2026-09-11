using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Identity;

namespace SiteStock.Api.Domain.Notifications;

/// <summary>What happened. Drives the wording, the icon and whether it makes a sound.</summary>
public enum NotificationKind
{
    /// <summary>Stock written off as lost, stolen or unexplained. Never silent.</summary>
    StockWrittenOff = 90,

    RequisitionSubmitted = 1,
    RequisitionPriced = 2,
    RequisitionApproved = 3,
    RequisitionRejected = 4,
    RequisitionSentBack = 5,

    DeliveryAccepted = 10,
    DeliveryRejected = 11,
    DeliveryShort = 12,

    StockLow = 20,

    TransferRequested = 30,
    TransferAnswered = 31,
    TransferDispatched = 32,
    TransferArrived = 33,

    InvoiceVariance = 40,
    PaymentReleased = 41,

    /// <summary>Rates on an order the owner had approved were changed by the buyer.</summary>
    PurchaseOrderRepriced = 42,

    /// <summary>Something has been waiting longer than the agreed time.</summary>
    ApprovalOverdue = 50,
    BudgetNearLimit = 51,
}

/// <summary>
/// How loudly to say it. The distinction is the whole point of having a sound at all —
/// a phone that chimes the same way for everything gets silenced within a week.
/// </summary>
public enum NotificationUrgency
{
    /// <summary>Worth knowing. No sound.</summary>
    Low = 1,

    /// <summary>Someone is waiting on you. A soft two-tone chime.</summary>
    Normal = 2,

    /// <summary>Work will stop, or money is at stake. A more insistent one.</summary>
    Urgent = 3,
}

/// <summary>
/// One thing one person needs to know.
///
/// <para>Until this existed the system was a set of queues that only worked if people
/// remembered to look at them. A requisition sat waiting and the owner was never told; a
/// delivery was refused and the purchase head found out on a phone call. Being right about
/// something nobody notices in time is not much use.</para>
///
/// <para>Rows are per recipient, not per event: three people needing to know produces three
/// rows, because each of them reads and dismisses it separately.</para>
/// </summary>
public class Notification : AuditableEntity
{
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    public NotificationKind Kind { get; set; }
    public NotificationUrgency Urgency { get; set; } = NotificationUrgency.Normal;

    /// <summary>One line, readable in a phone's notification shade.</summary>
    public string Title { get; set; } = string.Empty;

    public string? Body { get; set; }

    /// <summary>Where tapping it goes, e.g. <c>/requisitions/{id}</c>.</summary>
    public string? Link { get; set; }

    /// <summary>Which site it concerns, so it can be filtered with the site switcher.</summary>
    public Guid? SiteId { get; set; }

    /// <summary>
    /// Stops the same standing condition being raised over and over. Low stock is true for
    /// as long as it is true — telling somebody hourly is how a notification list becomes
    /// something people clear without reading.
    /// </summary>
    public string? DedupeKey { get; set; }

    public DateTimeOffset? ReadAt { get; set; }

    /// <summary>Set once the worker has emailed it, so a restart does not send it twice.</summary>
    public DateTimeOffset? EmailedAt { get; set; }

    /// <summary>False for anything only worth seeing in the app.</summary>
    public bool ShouldEmail { get; set; }

    public bool IsUnread => ReadAt is null;
}
