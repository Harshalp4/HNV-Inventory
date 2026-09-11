using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Domain.Inventory;

public enum TransferStatus
{
    /// <summary>The needing site has asked. The holding site has not answered yet.</summary>
    Requested = 1,

    /// <summary>The holding site agreed. Nothing has moved.</summary>
    Approved = 2,

    /// <summary>On a lorry. It has left the holding site and not arrived yet.</summary>
    InTransit = 3,

    /// <summary>Counted in at the far end. Terminal.</summary>
    Received = 4,

    /// <summary>The holding site said no, with a reason. Terminal.</summary>
    Declined = 5,

    /// <summary>Withdrawn by whoever asked. Terminal.</summary>
    Cancelled = 6,
}

/// <summary>
/// Moving material the company already owns from one site to another, instead of buying it
/// again.
///
/// <para>The source documents rate this as one of the largest savings available, and the
/// reason is unglamorous: a site runs out of cement while another site three kilometres away
/// has forty bags nobody knows about. This exists to make that visible before a purchase
/// order is raised.</para>
///
/// <para>Stock moves in <b>two</b> steps, not one. It leaves the holding site when the lorry
/// goes, and arrives at the needing site when somebody counts it in. Between the two it is
/// in transit and belongs to neither — which is exactly where it is.</para>
/// </summary>
public class TransferRequest : AuditableEntity
{
    /// <summary>e.g. <c>TRF-HDP-0007</c>, numbered against the site that needs it.</summary>
    public string Number { get; set; } = string.Empty;

    /// <summary>The site that has the material.</summary>
    public Guid FromSiteId { get; set; }
    public Site FromSite { get; set; } = null!;

    /// <summary>The site that needs it.</summary>
    public Guid ToSiteId { get; set; }
    public Site ToSite { get; set; } = null!;

    public TransferStatus Status { get; set; } = TransferStatus.Requested;

    public Guid RequestedById { get; set; }
    public User RequestedBy { get; set; } = null!;

    public string? Reason { get; set; }

    /// <summary>When the needing site wants it there.</summary>
    public DateOnly? NeededBy { get; set; }

    public DateTimeOffset? DecidedAt { get; set; }
    public Guid? DecidedById { get; set; }
    public User? DecidedBy { get; set; }

    /// <summary>Mandatory when declining. The asking site reads it.</summary>
    public string? DecisionNotes { get; set; }

    public DateTimeOffset? DispatchedAt { get; set; }
    public Guid? DispatchedById { get; set; }
    public User? DispatchedBy { get; set; }
    public string? VehicleNumber { get; set; }

    public DateTimeOffset? ReceivedAt { get; set; }
    public Guid? ReceivedById { get; set; }
    public User? ReceivedBy { get; set; }

    /// <summary>
    /// What the lorry costs. Recorded so the comparison against buying new is a real one —
    /// a transfer that costs more in transport than the material is worth is not a saving.
    /// </summary>
    public decimal? TransportCost { get; set; }

    public string? Notes { get; set; }

    public ICollection<TransferLine> Lines { get; set; } = [];

    public bool IsOpen => Status is TransferStatus.Requested
                              or TransferStatus.Approved
                              or TransferStatus.InTransit;
}

/// <summary>
/// One material on a transfer. Three quantities, for the same reason a goods receipt keeps
/// three: what was asked for, what was actually sent, and what arrived.
/// </summary>
public class TransferLine : AuditableEntity
{
    public Guid TransferRequestId { get; set; }
    public TransferRequest TransferRequest { get; set; } = null!;

    public Guid MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    public decimal RequestedQuantity { get; set; }

    /// <summary>Agreed by the holding site. May be less than asked.</summary>
    public decimal? ApprovedQuantity { get; set; }

    /// <summary>What actually went on the lorry.</summary>
    public decimal? DispatchedQuantity { get; set; }

    /// <summary>What was counted in at the far end. A gap means something went missing.</summary>
    public decimal? ReceivedQuantity { get; set; }

    /// <summary>
    /// Valued at the holding site's last purchase rate, frozen at dispatch. Without it the
    /// transfer is invisible in the cost of either job.
    /// </summary>
    public decimal? UnitValue { get; set; }

    public string? Notes { get; set; }

    public decimal ShortfallQuantity =>
        (DispatchedQuantity ?? 0m) - (ReceivedQuantity ?? DispatchedQuantity ?? 0m);
}
