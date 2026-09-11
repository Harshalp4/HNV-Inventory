using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Contracts;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Domain.Procurement;

/// <summary>
/// Generated when the owner approves — never written by hand, and never editable
/// afterwards. One order per supplier: a requisition awarded across three suppliers
/// produces three orders, because a supplier can only be held to their own lines.
/// </summary>
public class PurchaseOrder : AuditableEntity
{
    /// <summary>e.g. <c>HNP-KLW-2418</c>. This is the number everyone quotes on the phone.</summary>
    public string Number { get; set; } = string.Empty;

    public Guid RequisitionId { get; set; }
    public Requisition Requisition { get; set; } = null!;

    public Guid SiteId { get; set; }
    public Site Site { get; set; } = null!;

    public Guid SupplierId { get; set; }
    public Supplier Supplier { get; set; } = null!;

    /// <summary>
    /// Which client contract this spend belongs to. Copied from the requisition at approval
    /// and correctable afterwards on the order — a purchase tagged to the wrong job makes
    /// both jobs' figures wrong, so it has to be fixable without unpicking the order.
    /// </summary>
    public Guid? WorkOrderId { get; set; }
    public WorkOrder? WorkOrder { get; set; }

    public PurchaseOrderStatus Status { get; set; } = PurchaseOrderStatus.Issued;

    /// <summary>
    /// Whether this order may go out yet. Decided when the order is raised, from the
    /// company's own setting — a gate switched on afterwards must not silently freeze the
    /// orders already sitting on somebody's desk.
    /// </summary>
    public SendApproval SendApproval { get; set; } = SendApproval.NotRequired;

    public DateTimeOffset? SendApprovalDecidedAt { get; set; }
    public Guid? SendApprovalDecidedById { get; set; }
    public User? SendApprovalDecidedBy { get; set; }

    /// <summary>What the approver said — required when they send it back.</summary>
    public string? SendApprovalNote { get; set; }

    public DateTimeOffset IssuedAt { get; set; }
    public Guid IssuedById { get; set; }
    public User IssuedBy { get; set; } = null!;

    public DateOnly ExpectedDelivery { get; set; }

    /// <summary>Frozen at issue. The supplier is held to these figures, not to today's rates.</summary>
    public decimal SubTotal { get; set; }
    public decimal TaxTotal { get; set; }
    public decimal GrandTotal { get; set; }

    /// <summary>Copied from the supplier at issue, so a later change to their terms does not rewrite history.</summary>
    public int PaymentTermsDays { get; set; }

    public string? DeliveryInstructions { get; set; }

    /// <summary>
    /// Printed in the note box on the order, above the terms. Copied from the requisition at
    /// issue rather than read through it, for the same reason as the payment terms: what the
    /// supplier was sent must not change because somebody edited something else later.
    /// </summary>
    public string? Notes { get; set; }

    /// <summary>
    /// Set when an order is withdrawn before the supplier was ever told about it — the site
    /// amended the requisition while the order was still sitting unsent. Reports and budgets
    /// already skip cancelled orders, so the money unwinds with it.
    /// </summary>
    public DateTimeOffset? CancelledAt { get; set; }

    /// <summary>Why it was cancelled, in words, so the order explains itself on its own page.</summary>
    public string? CancellationReason { get; set; }

    /// <summary>Who withdrew it. Every other decision on this order names somebody; so does this.</summary>
    public Guid? CancelledById { get; set; }
    public User? CancelledBy { get; set; }

    public ICollection<PurchaseOrderLine> Lines { get; set; } = [];
    public ICollection<PurchaseOrderCommunication> Communications { get; set; } = [];

    /// <summary>Every change made after it was raised, newest last.</summary>
    public ICollection<PurchaseOrderChange> Changes { get; set; } = [];
}

public class PurchaseOrderLine : AuditableEntity
{
    public Guid PurchaseOrderId { get; set; }
    public PurchaseOrder PurchaseOrder { get; set; } = null!;

    /// <summary>Traces the ordered line back to what the site actually asked for.</summary>
    public Guid RequisitionLineId { get; set; }
    public RequisitionLine RequisitionLine { get; set; } = null!;

    public Guid MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    public decimal Quantity { get; set; }

    /// <summary>The maker's catalogue number, as quoted. Frozen at issue.</summary>
    public string? ProductCode { get; set; }

    /// <summary>The brand agreed — the supplier is held to this, not to whatever is cheapest.</summary>
    public string? Make { get; set; }

    /// <summary>List price before discount, where the quote was given that way.</summary>
    public decimal? ListRate { get; set; }

    /// <summary>Trade discount off that list price, as a percentage.</summary>
    public decimal? DiscountPercent { get; set; }

    public decimal UnitRate { get; set; }
    public decimal TaxPercent { get; set; }
    public decimal LineTotal { get; set; }
    public decimal TaxAmount { get; set; }

    public string? Notes { get; set; }
}

/// <summary>
/// Every time the order is sent to the supplier, through any channel, a row lands here.
/// "Did anyone actually send it?" has to be answerable without asking around — and when
/// the delivery is late, this is the record that settles who said what.
/// </summary>
public class PurchaseOrderCommunication : AuditableEntity
{
    public Guid PurchaseOrderId { get; set; }
    public PurchaseOrder PurchaseOrder { get; set; } = null!;

    public CommunicationChannel Channel { get; set; }
    public CommunicationStatus Status { get; set; } = CommunicationStatus.Recorded;

    /// <summary>Email address, phone number, or the name of whoever it was handed to.</summary>
    public string Recipient { get; set; } = string.Empty;

    public DateTimeOffset SentAt { get; set; }
    public Guid SentById { get; set; }
    public User SentBy { get; set; } = null!;

    public string? Notes { get; set; }

    /// <summary>Why a dispatch failed, or why it is only recorded rather than sent.</summary>
    public string? FailureReason { get; set; }
}
