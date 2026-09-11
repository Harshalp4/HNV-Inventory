using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;

namespace SiteStock.Api.Domain.Contracts;

/// <summary>
/// One item on the client's work order — what they have asked for, and how much of it.
///
/// <para>The contract value alone answers "how much of this job's money have we committed".
/// It cannot answer "the client asked for 500 switches, how many have we actually bought" —
/// and that is the question that catches an over-order before the material is on site and
/// nobody will take it back.</para>
///
/// <para>Quantities are compared against purchase order lines <b>by material</b>, which is why
/// the line points at the material list rather than being free text. The client's own wording
/// is kept beside it, because their BOQ description is what the argument will be about.</para>
/// </summary>
public class WorkOrderLine : AuditableEntity
{
    public Guid WorkOrderId { get; set; }
    public WorkOrder WorkOrder { get; set; } = null!;

    public Guid MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    /// <summary>
    /// The client's own item number for this line — 1302651 on a Kalpataru order. Theirs,
    /// not ours: it is what a query from their site office will quote.
    /// </summary>
    public string? ClientItemCode { get; set; }

    /// <summary>
    /// The heading this line sits under on their sheet — ELECTRICAL PANELS, CABLE TRAY,
    /// POINT WIRING &amp; CONDUITING. Their annexure numbers items 1.1, 1.2 under a section 1,
    /// and totals each section; reading a hundred lines without those breaks is hopeless.
    /// </summary>
    public string? Section { get; set; }

    /// <summary>The client's own wording, as it reads on their sheet. Often a paragraph.</summary>
    public string? Description { get; set; }

    /// <summary>The SAC or HSN they billed the line under — 995411 for electrical works.</summary>
    public string? SacHsnCode { get; set; }

    /// <summary>GST on this line as their sheet states it, usually 18.</summary>
    public decimal? TaxPercent { get; set; }

    public decimal Quantity { get; set; }

    /// <summary>
    /// What the client pays per unit. The <b>sale</b> rate — it carries labour and margin, so
    /// it is never the same animal as the rate we buy at, and must never be shown as though
    /// it were comparable.
    /// </summary>
    public decimal? Rate { get; set; }

    /// <summary>Keeps the client's own order of items, which is how they will read it back.</summary>
    public int SortOrder { get; set; }

    public decimal LineValue => Quantity * (Rate ?? 0m);
}
