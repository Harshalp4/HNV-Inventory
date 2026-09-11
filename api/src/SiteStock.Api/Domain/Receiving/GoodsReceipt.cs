using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Organisation;
using SiteStock.Api.Domain.Procurement;

namespace SiteStock.Api.Domain.Receiving;

public enum GoodsReceiptStatus
{
    /// <summary>Being counted at the gate. Nothing has entered stock.</summary>
    Draft = 1,
    /// <summary>Accepted — stock movements written. Terminal.</summary>
    Accepted = 2,
    /// <summary>Rejected with photo proof. Nothing entered stock. Terminal.</summary>
    Rejected = 3,
}

/// <summary>
/// What the supervisor decides about the balance when less arrives than was ordered.
/// The specification calls this out because it is the single most consequential choice
/// on the receiving screen and the one people get wrong.
/// </summary>
public enum ShortfallDecision
{
    /// <summary>Not short, or not decided yet.</summary>
    NotApplicable = 0,
    /// <summary>The balance is still coming. The order stays open for a second delivery.</summary>
    HoldOpen = 1,
    /// <summary>Write off the balance. The supplier cannot bill for it and the order closes.</summary>
    CloseShort = 2,
}

public enum RejectionReason
{
    WrongMaterial = 1,
    DamagedInTransit = 2,
    QualityBelowSpecification = 3,
    ShortWeightOrCount = 4,
    NoCertificate = 5,
    WrongSiteOrOrder = 6,
    Other = 99,
}

/// <summary>
/// A delivery arriving at the gate, counted against a purchase order.
///
/// This is the record everything financial later hangs off: the three-way match in Phase 2
/// compares the invoice to <b>the accepted quantity here</b>, not to what was ordered. If
/// this is wrong, the matching engine is noise.
/// </summary>
public class GoodsReceipt : AuditableEntity
{
    /// <summary>e.g. <c>GRN-KLW-0180</c>.</summary>
    public string Number { get; set; } = string.Empty;

    public Guid PurchaseOrderId { get; set; }
    public PurchaseOrder PurchaseOrder { get; set; } = null!;

    public Guid SiteId { get; set; }
    public Site Site { get; set; } = null!;

    public GoodsReceiptStatus Status { get; set; } = GoodsReceiptStatus.Draft;

    public Guid ReceivedById { get; set; }
    public User ReceivedBy { get; set; } = null!;

    public DateTimeOffset ReceivedAt { get; set; }

    /// <summary>The supplier's delivery note number, as written on the paper.</summary>
    public string? ChallanNumber { get; set; }
    public DateOnly? ChallanDate { get; set; }
    public string? VehicleNumber { get; set; }
    public string? DriverName { get; set; }

    // ── the four inspection checks from the specification ────────────────────

    /// <summary>Is it the material that was ordered?</summary>
    public bool CheckedMaterialMatches { get; set; }
    /// <summary>Does the count or weight agree with the challan?</summary>
    public bool CheckedQuantityMatches { get; set; }
    /// <summary>Is the condition acceptable — no damage, no wet cement, no rust?</summary>
    public bool CheckedConditionAcceptable { get; set; }
    /// <summary>Is the test or mill certificate present where the material requires one?</summary>
    public bool CheckedCertificatePresent { get; set; }

    public ShortfallDecision Shortfall { get; set; } = ShortfallDecision.NotApplicable;

    public RejectionReason? RejectionReason { get; set; }

    /// <summary>Mandatory on rejection. Read by the purchase head and, eventually, the supplier.</summary>
    public string? RejectionNotes { get; set; }

    public string? Notes { get; set; }

    public DateTimeOffset? DecidedAt { get; set; }

    public ICollection<GoodsReceiptLine> Lines { get; set; } = [];

    public bool IsEditable => Status == GoodsReceiptStatus.Draft;

    public bool AllChecksDone =>
        CheckedMaterialMatches && CheckedQuantityMatches
        && CheckedConditionAcceptable && CheckedCertificatePresent;
}

/// <summary>
/// One material on a delivery. Three quantities are kept separately and never collapsed:
/// what was <b>ordered</b>, what <b>arrived</b>, and what was <b>accepted</b>. The
/// difference between the last two is a rejection; between the first two, a shortfall.
/// Phase 2's matching engine reads all three.
/// </summary>
public class GoodsReceiptLine : AuditableEntity
{
    public Guid GoodsReceiptId { get; set; }
    public GoodsReceipt GoodsReceipt { get; set; } = null!;

    public Guid PurchaseOrderLineId { get; set; }
    public PurchaseOrderLine PurchaseOrderLine { get; set; } = null!;

    public Guid MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    /// <summary>Copied from the order at receipt so later edits upstream cannot rewrite history.</summary>
    public decimal OrderedQuantity { get; set; }

    /// <summary>What actually came off the lorry, counted.</summary>
    public decimal ReceivedQuantity { get; set; }

    /// <summary>What went into stock. Below received means part of the load was refused.</summary>
    public decimal AcceptedQuantity { get; set; }

    public string? Notes { get; set; }

    public decimal RejectedQuantity => ReceivedQuantity - AcceptedQuantity;
    public decimal ShortQuantity => OrderedQuantity - ReceivedQuantity;
}
