using SiteStock.Api.Domain.Procurement;

namespace SiteStock.Api.Features.Requisitions;

/// <summary>
/// When a requisition can still be changed by the site.
///
/// <para>The line is not "has it been approved" but "has a supplier been told". Approval
/// generates the orders; until one of them actually goes out, nothing has been promised to
/// anybody outside the company, and the slab that grew this morning is still a change the
/// site is entitled to make. Refusing it at approval only means the change happens by phone
/// call and the system never hears about it — the exact failure this feature exists to stop.
/// </para>
///
/// <para>Amending an approved requisition is not free: the unsent orders are cancelled and
/// the request goes back for re-pricing and a fresh approval, because an owner's approval of
/// ₹38,350 is an approval of those lines and not of whatever replaced them.</para>
///
/// <para>The orders are passed in rather than read off the navigation property. A requisition
/// loaded without <c>Include(r =&gt; r.PurchaseOrders)</c> has an empty collection, and an
/// empty collection would read as "nothing has been sent" — which is how a supervisor ends up
/// amending an order that left the building last Tuesday.</para>
/// </summary>
public static class Amendability
{
    /// <returns><c>null</c> when the site may amend it, otherwise why it may not.</returns>
    public static string? Blocker(RequisitionStatus status, IEnumerable<PurchaseOrderStatus> orders)
    {
        if (status is RequisitionStatus.Submitted or RequisitionStatus.Priced)
            return null;

        if (status == RequisitionStatus.Draft)
            return "This is still a draft — edit it directly rather than amending it.";

        if (status != RequisitionStatus.Approved)
        {
            return $"This requisition is {status.ToString().ToLowerInvariant()}, " +
                   "so it can no longer be changed.";
        }

        // A cancelled order is already dead and holds nothing back.
        var live = orders.Where(s => s != PurchaseOrderStatus.Cancelled).ToList();

        if (live.Count == 0)
            return null;

        return live.All(s => s == PurchaseOrderStatus.Issued)
            ? null
            : "The supplier has already been sent this order, so it can no longer be changed here. "
              + "Ring the purchase head — a delivery may already be on its way.";
    }

    /// <summary>
    /// True when amending will unwind orders that have already been raised, so the screen can
    /// warn the supervisor before they type rather than after they save.
    /// </summary>
    public static bool WouldCancelOrders(
        RequisitionStatus status, IEnumerable<PurchaseOrderStatus> orders) =>
        status == RequisitionStatus.Approved
        && orders.Any(s => s == PurchaseOrderStatus.Issued);
}
