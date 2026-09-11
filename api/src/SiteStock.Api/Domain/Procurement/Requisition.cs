using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Contracts;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Domain.Procurement;

/// <summary>
/// "The site needs these materials." Everything downstream — the order, the delivery, the
/// invoice, the stock movement — traces back to one of these.
/// </summary>
public class Requisition : AuditableEntity
{
    /// <summary>Human reference, e.g. <c>REQ-KLW-0014</c>. Unique, and quoted on the phone.</summary>
    public string Number { get; set; } = string.Empty;

    public Guid SiteId { get; set; }
    public Site Site { get; set; } = null!;

    public Guid RequestedById { get; set; }
    public User RequestedBy { get; set; } = null!;

    /// <summary>
    /// The client contract this is for. Optional — general site consumables belong to no
    /// particular job. Set here so it flows to every order the approval generates, rather
    /// than being tagged onto each one by hand afterwards.
    /// </summary>
    public Guid? WorkOrderId { get; set; }
    public WorkOrder? WorkOrder { get; set; }

    public RequisitionStatus Status { get; set; } = RequisitionStatus.Draft;
    public RequisitionPriority Priority { get; set; } = RequisitionPriority.Normal;

    /// <summary>When the site needs it on the ground, not when the order should be placed.</summary>
    public DateOnly RequiredBy { get; set; }

    public string? Notes { get; set; }

    public DateTimeOffset? SubmittedAt { get; set; }

    public DateTimeOffset? PricedAt { get; set; }
    public Guid? PricedById { get; set; }
    public User? PricedBy { get; set; }

    public DateTimeOffset? DecidedAt { get; set; }
    public Guid? DecidedById { get; set; }
    public User? DecidedBy { get; set; }

    /// <summary>
    /// Mandatory on rejection and on sending back. A decision without a reason is not a
    /// decision anybody can learn from six weeks later.
    /// </summary>
    public string? DecisionReason { get; set; }

    /// <summary>
    /// When the site last changed this after sending it on, and whether that change landed
    /// after somebody had already priced it. Kept on the requisition rather than derived from
    /// the amendment rows so the list screen can flag it without loading them all.
    /// </summary>
    public DateTimeOffset? AmendedAt { get; set; }
    public DateTimeOffset? AmendedAfterPricingAt { get; set; }

    /// <summary>
    /// A note the buyer writes when pricing, printed on every purchase order this request
    /// produces — "material to reach site before 8 am", "unloading by supplier". It lives on
    /// the request because the orders do not exist yet at the moment it is written.
    /// </summary>
    public string? SupplierNote { get; set; }

    public ICollection<RequisitionLine> Lines { get; set; } = [];

    /// <summary>Credit agreed with a supplier for this purchase, where it differs from theirs.</summary>
    public ICollection<RequisitionSupplierTerm> SupplierTerms { get; set; } = [];
    public ICollection<RequisitionAmendment> Amendments { get; set; } = [];
    public ICollection<PurchaseOrder> PurchaseOrders { get; set; } = [];

    /// <summary>Lines are only editable by the raiser while the requisition is still a draft.</summary>
    public bool IsEditable => Status == RequisitionStatus.Draft;

    public bool IsOpen => Status is RequisitionStatus.Draft
                              or RequisitionStatus.Submitted
                              or RequisitionStatus.Priced;
}
