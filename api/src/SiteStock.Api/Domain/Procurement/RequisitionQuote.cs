using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;

namespace SiteStock.Api.Domain.Procurement;

/// <summary>
/// What a supplier said this line would cost. Kept even after the award, because the value
/// of comparing quotes is being able to show, months later, what the alternatives were —
/// and because a supplier who is always second-cheapest is worth a conversation.
/// </summary>
public class RequisitionQuote : AuditableEntity
{
    public Guid RequisitionLineId { get; set; }
    public RequisitionLine RequisitionLine { get; set; } = null!;

    public Guid SupplierId { get; set; }
    public Supplier Supplier { get; set; } = null!;

    public decimal UnitRate { get; set; }
    public decimal TaxPercent { get; set; }

    /// <summary>Days from order to delivery, as quoted. The cheapest is not always the right one.</summary>
    public int? LeadTimeDays { get; set; }

    public string? Notes { get; set; }
}
