using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Features.Requisitions;

namespace SiteStock.Api.Tests;

/// <summary>
/// When a requisition may still be changed by the site.
///
/// <para>The line is not approval but dispatch. Approval generates the purchase orders, and
/// until one of them actually goes to a supplier nothing has been promised outside the
/// company — so a site that needs sixty bags instead of forty may still say so. Once an order
/// has gone, it may not: a lorry could already be loading.</para>
/// </summary>
public class AmendmentRulesTests
{
    private static readonly PurchaseOrderStatus[] Nothing = [];

    [Theory]
    [InlineData(RequisitionStatus.Submitted)]
    [InlineData(RequisitionStatus.Priced)]
    public void The_site_can_change_it_while_nothing_has_been_ordered(RequisitionStatus status)
    {
        Assert.Null(Amendability.Blocker(status, Nothing));
    }

    [Theory]
    [InlineData(RequisitionStatus.Draft)]
    [InlineData(RequisitionStatus.Rejected)]
    [InlineData(RequisitionStatus.Cancelled)]
    public void It_cannot_be_amended_outside_that_window(RequisitionStatus status)
    {
        Assert.NotNull(Amendability.Blocker(status, Nothing));
    }

    [Fact]
    public void An_approved_requisition_can_still_change_while_the_orders_sit_unsent()
    {
        var orders = new[] { PurchaseOrderStatus.Issued, PurchaseOrderStatus.Issued };

        Assert.Null(Amendability.Blocker(RequisitionStatus.Approved, orders));
        Assert.True(Amendability.WouldCancelOrders(RequisitionStatus.Approved, orders));
    }

    [Theory]
    [InlineData(PurchaseOrderStatus.Sent)]
    [InlineData(PurchaseOrderStatus.PartiallyReceived)]
    [InlineData(PurchaseOrderStatus.Received)]
    [InlineData(PurchaseOrderStatus.Closed)]
    public void Once_a_supplier_has_been_told_the_site_can_no_longer_change_it(
        PurchaseOrderStatus gone)
    {
        // One order out of two is enough: the supplier holding it has been promised something.
        var orders = new[] { PurchaseOrderStatus.Issued, gone };

        Assert.NotNull(Amendability.Blocker(RequisitionStatus.Approved, orders));
    }

    /// <summary>An order already withdrawn holds nothing back.</summary>
    [Fact]
    public void A_cancelled_order_does_not_block_an_amendment()
    {
        var orders = new[] { PurchaseOrderStatus.Cancelled, PurchaseOrderStatus.Issued };

        Assert.Null(Amendability.Blocker(RequisitionStatus.Approved, orders));
    }

    /// <summary>
    /// The dangerous case. A requisition loaded without its orders has an empty collection,
    /// and "no orders" must never be read as "approved, so go ahead" for a requisition whose
    /// orders simply were not fetched. Callers pass the statuses in explicitly for this
    /// reason; this test pins the behaviour of the empty case so the meaning stays deliberate.
    /// </summary>
    [Fact]
    public void An_approved_requisition_with_no_orders_at_all_is_amendable_and_cancels_nothing()
    {
        Assert.Null(Amendability.Blocker(RequisitionStatus.Approved, Nothing));
        Assert.False(Amendability.WouldCancelOrders(RequisitionStatus.Approved, Nothing));
    }

    [Fact]
    public void Nothing_is_cancelled_by_amending_before_approval()
    {
        Assert.False(Amendability.WouldCancelOrders(RequisitionStatus.Priced, Nothing));
        Assert.False(Amendability.WouldCancelOrders(
            RequisitionStatus.Submitted, [PurchaseOrderStatus.Issued]));
    }

    /// <summary>
    /// A draft is edited, not amended. If both were true of the same requisition there would
    /// be two ways to change one thing, and only one of them writes any history.
    /// </summary>
    [Fact]
    public void Editing_and_amending_never_both_apply()
    {
        foreach (var status in Enum.GetValues<RequisitionStatus>())
        {
            var editable = new Requisition { Status = status }.IsEditable;
            var amendable = Amendability.Blocker(status, Nothing) is null;

            Assert.False(editable && amendable, $"{status} is both editable and amendable");
        }
    }
}
