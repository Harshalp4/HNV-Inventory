using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;

namespace SiteStock.Api.Domain.Procurement;

/// <summary>
/// The credit agreed with one supplier for this purchase, when it is not their usual.
///
/// <para>Payment terms belong to a supplier, not to a request — which is why the supplier
/// record carries them and the order copies them at issue. But the credit for a particular
/// purchase is sometimes negotiated with the rate ("sixty days on this one"), and that is
/// settled while the buyer is pricing, before any order exists to write it on. So it is
/// captured here, against the request and the supplier it was agreed with, and the order
/// picks it up when it is generated.</para>
///
/// <para>One row per supplier rather than one figure per request: a request awarded across
/// three suppliers is three orders, and forcing one supplier's credit onto the other two
/// would put a term on paper that nobody agreed to.</para>
/// </summary>
public class RequisitionSupplierTerm : AuditableEntity
{
    public Guid RequisitionId { get; set; }
    public Requisition Requisition { get; set; } = null!;

    public Guid SupplierId { get; set; }
    public Supplier Supplier { get; set; } = null!;

    public int PaymentTermsDays { get; set; }
}
