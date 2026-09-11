using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;

namespace SiteStock.Api.Domain.Procurement;

/// <summary>
/// One material on a requisition. The supervisor fills in the top half (what and how much);
/// the purchase head fills in the bottom half (from whom and at what rate).
/// </summary>
public class RequisitionLine : AuditableEntity
{
    public Guid RequisitionId { get; set; }
    public Requisition Requisition { get; set; } = null!;

    public Guid MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    /// <summary>Three decimals so a tonne of steel is not rounded like a bag of cement.</summary>
    public decimal Quantity { get; set; }

    /// <summary>The supervisor's note — "for the 4th slab", "east block plaster".</summary>
    public string? Notes { get; set; }

    /// <summary>
    /// Set when this line was added, or its quantity changed, after the requisition had
    /// already been sent on. Drives the highlight — a purchase head must be able to see at a
    /// glance which lines are not the ones he read the first time.
    /// </summary>
    public DateTimeOffset? AmendedAt { get; set; }

    /// <summary>The quantity before the most recent amendment, for "was 40" on screen.</summary>
    public decimal? QuantityBefore { get; set; }

    // ── filled by the purchase head ──────────────────────────────────────────

    /// <summary>Which supplier won this line. Different lines may go to different suppliers.</summary>
    public Guid? AwardedSupplierId { get; set; }
    public Supplier? AwardedSupplier { get; set; }

    /// <summary>
    /// The maker's own catalogue number for what is being bought — printed beside the
    /// description so the supplier picks the right item off the shelf. Not our material code:
    /// "6A switch" is one material to us and four different part numbers to Anchor.
    /// </summary>
    public string? ProductCode { get; set; }

    /// <summary>The brand quoted — Anchor, Polycab, Finolex. Decided when the rate is agreed.</summary>
    public string? Make { get; set; }

    /// <summary>
    /// The published list price before any trade discount. Optional: plenty of purchases are
    /// quoted as one net figure, and inventing a list price to fill a column would be a lie.
    /// </summary>
    public decimal? ListRate { get; set; }

    /// <summary>Trade discount off the list price, as a percentage.</summary>
    public decimal? DiscountPercent { get; set; }

    /// <summary>
    /// What the supplier is actually held to, per unit. Derived from the list price and the
    /// discount when both are given, so the three figures on the printed order can never
    /// disagree with each other.
    /// </summary>
    public decimal? UnitRate { get; set; }

    /// <summary>GST on this line, as a percentage.</summary>
    public decimal? TaxPercent { get; set; }

    public string? PricingNotes { get; set; }

    public ICollection<RequisitionQuote> Quotes { get; set; } = [];

    public bool IsPriced => AwardedSupplierId.HasValue && UnitRate.HasValue;

    public decimal LineTotal => Quantity * (UnitRate ?? 0m);
    public decimal TaxAmount => Math.Round(LineTotal * (TaxPercent ?? 0m) / 100m, 2);
    public decimal LineTotalWithTax => LineTotal + TaxAmount;
}
