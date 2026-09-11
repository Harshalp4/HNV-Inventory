using SiteStock.Api.Domain.Billing;
using SiteStock.Api.Features.Invoices;

namespace SiteStock.Api.Tests;

/// <summary>
/// The payable calculation is the number a supplier actually gets paid, so it is worth
/// pinning down separately from the database. Each test is the business rule it protects.
/// </summary>
public class PayableCalculationTests
{
    private static Invoice Billed(decimal total, params InvoiceVariance[] variances) => new()
    {
        GrandTotal = total,
        Variances = variances.ToList(),
    };

    private static InvoiceVariance Variance(
        decimal amount, VarianceType type = VarianceType.QuantityMismatch,
        VarianceResolution? resolution = null) => new()
    {
        Type = type,
        DifferenceAmount = amount,
        Resolution = resolution,
        ResolvedAt = resolution is null ? null : DateTimeOffset.UtcNow,
        Description = "test",
    };

    [Fact]
    public void A_clean_bill_is_paid_in_full()
    {
        Assert.Equal(49_280m, ThreeWayMatcher.CalculatePayable(Billed(49_280m)));
    }

    [Fact]
    public void An_unresolved_difference_is_held_back()
    {
        // Nothing is paid on a difference nobody has explained — that is the whole control.
        var invoice = Billed(49_280m, Variance(10_841.60m));

        Assert.Equal(38_438.40m, ThreeWayMatcher.CalculatePayable(invoice));
    }

    [Fact]
    public void Paying_our_figure_keeps_the_deduction()
    {
        var invoice = Billed(49_280m, Variance(10_841.60m, resolution: VarianceResolution.PayOurFigure));

        Assert.Equal(38_438.40m, ThreeWayMatcher.CalculatePayable(invoice));
    }

    [Fact]
    public void Accepting_the_supplier_figure_pays_what_they_billed()
    {
        // We were wrong, so the deduction comes off — the supplier gets their full amount.
        var invoice = Billed(49_280m,
            Variance(10_841.60m, resolution: VarianceResolution.AcceptSupplierFigure));

        Assert.Equal(49_280m, ThreeWayMatcher.CalculatePayable(invoice));
    }

    [Fact]
    public void Awaiting_a_credit_note_still_pays_our_figure_now()
    {
        var invoice = Billed(49_280m,
            Variance(10_841.60m, resolution: VarianceResolution.AwaitCreditNote));

        Assert.Equal(38_438.40m, ThreeWayMatcher.CalculatePayable(invoice));
    }

    [Fact]
    public void Several_differences_all_come_off()
    {
        var invoice = Billed(100_000m,
            Variance(5_000m),
            Variance(2_500m, VarianceType.PriceMismatch),
            Variance(1_200m, VarianceType.TaxMismatch));

        Assert.Equal(91_300m, ThreeWayMatcher.CalculatePayable(invoice));
    }

    [Fact]
    public void A_duplicate_does_not_reduce_the_payable_of_this_bill()
    {
        // The duplicate flag is about refusing to pay twice, not about paying less on
        // whichever copy happens to be open. Deducting it would understate the real bill.
        var invoice = Billed(49_280m, Variance(49_280m, VarianceType.DuplicateInvoice));

        Assert.Equal(49_280m, ThreeWayMatcher.CalculatePayable(invoice));
    }

    [Fact]
    public void The_payable_never_goes_below_zero()
    {
        var invoice = Billed(5_000m, Variance(9_000m));

        Assert.Equal(0m, ThreeWayMatcher.CalculatePayable(invoice));
    }
}
