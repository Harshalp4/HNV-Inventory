using SiteStock.Api.Features.PurchaseOrders;

namespace SiteStock.Api.Tests;

/// <summary>
/// The words on a purchase order are what a supplier reads when the figures are smudged or
/// disputed, so they have to be right in Indian grouping — lakh and crore, not million.
/// </summary>
public class AmountInWordsTests
{
    [Theory]
    [InlineData(0, "RUPEES ZERO ONLY")]
    [InlineData(1, "RUPEES ONE ONLY")]
    [InlineData(15, "RUPEES FIFTEEN ONLY")]
    [InlineData(100, "RUPEES ONE HUNDRED ONLY")]
    [InlineData(38350, "RUPEES THIRTY EIGHT THOUSAND THREE HUNDRED AND FIFTY ONLY")]
    public void Spells_whole_rupees(decimal amount, string expected)
        => Assert.Equal(expected, AmountInWords.Of(amount));

    [Fact]
    public void Groups_in_lakh_and_crore_not_millions()
    {
        Assert.Contains("LAKH", AmountInWords.Of(250_000m));
        Assert.Contains("CRORE", AmountInWords.Of(12_500_000m));
        Assert.DoesNotContain("MILLION", AmountInWords.Of(12_500_000m));
    }

    [Fact]
    public void Spells_paise_when_there_are_any()
    {
        var words = AmountInWords.Of(1234.50m);
        Assert.Contains("FIFTY PAISE", words);
        Assert.EndsWith("ONLY", words);
    }

    [Fact]
    public void Rounds_paise_that_carry_into_the_rupee()
    {
        // 99.995 rounds to 100.00 — the rupees must move, and no "HUNDRED PAISE" may appear.
        var words = AmountInWords.Of(99.995m);
        Assert.Equal("RUPEES ONE HUNDRED ONLY", words);
    }
}
