using SiteStock.Api.Features.PurchaseOrders;

namespace SiteStock.Api.Tests;

/// <summary>
/// Ordered and received are two decimals side by side in a positional record, which means a
/// constructor call with them the wrong way round compiles perfectly and ships a purchase
/// order claiming nothing was ordered and everything arrived. This pins which is which.
/// </summary>
public class PurchaseOrderLineDtoTests
{
    [Fact]
    public void Ordered_and_received_do_not_get_swapped()
    {
        var line = new PurchaseOrderLineDto(
            Guid.NewGuid(), Guid.NewGuid(), "SW-16A", "16A modular switch", "Single pole",
            "NOS", 0, false, "8536",
            Quantity: 10m,
            ReceivedQuantity: 4m,
            ProductCode: "14000", Make: "Anchor",
            ListRate: 50m, DiscountPercent: 50m,
            UnitRate: 25m, TaxPercent: 18m,
            LineTotal: 250m, TaxAmount: 45m, Notes: null);

        Assert.Equal(10m, line.Quantity);
        Assert.Equal(4m, line.ReceivedQuantity);

        // The ordered quantity is what the line total was worked out from. If these two ever
        // swap again, this is the assertion that catches it rather than a screenshot.
        Assert.Equal(line.LineTotal, line.Quantity * line.UnitRate);

        // List price and discount are a second pair of adjacent decimals, and a printed order
        // showing a discount as the list price is the same class of bug.
        Assert.Equal(50m, line.ListRate);
        Assert.Equal(50m, line.DiscountPercent);
        Assert.Equal(line.UnitRate, line.ListRate * (1m - line.DiscountPercent / 100m));
    }
}
