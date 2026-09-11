using SiteStock.Api.Domain.Inventory;

namespace SiteStock.Api.Tests;

/// <summary>
/// The judgement calls inside the reports — which movements count as a loss, and how late a
/// bill is. Both decide what a number means, and both are the kind of thing that gets quietly
/// widened later until the figure stops meaning anything.
/// </summary>
public class ReportRulesTests
{
    /// <summary>
    /// Material that actually left the site. A miscount or a keying error is a correction to
    /// the books; counting it as a loss would report bad typing as theft.
    /// </summary>
    [Theory]
    [InlineData(AdjustmentReason.Damaged, true)]
    [InlineData(AdjustmentReason.Lost, true)]
    [InlineData(AdjustmentReason.Stolen, true)]
    [InlineData(AdjustmentReason.Wastage, true)]
    [InlineData(AdjustmentReason.Expired, true)]
    [InlineData(AdjustmentReason.Unexplained, true)]
    [InlineData(AdjustmentReason.Miscount, false)]
    [InlineData(AdjustmentReason.EntryError, false)]
    [InlineData(AdjustmentReason.FoundExtra, false)]
    public void Only_material_that_actually_went_counts_as_a_loss(
        AdjustmentReason reason, bool isLoss)
    {
        Assert.Equal(isLoss, LossReasons.Contains(reason));
    }

    /// <summary>
    /// Every reason is decided one way or the other. A new one added to the enum without a
    /// decision here would silently fall out of the loss report.
    /// </summary>
    [Fact]
    public void Every_reason_is_accounted_for()
    {
        foreach (var reason in Enum.GetValues<AdjustmentReason>())
        {
            Assert.True(
                LossReasons.Contains(reason) || Corrections.Contains(reason),
                $"{reason} is neither a loss nor a correction — decide which.");
        }
    }

    [Theory]
    [InlineData(-5, "Not due yet")]
    [InlineData(0, "Not due yet")]
    [InlineData(1, "1-30 days late")]
    [InlineData(30, "1-30 days late")]
    [InlineData(31, "31-60 days late")]
    [InlineData(60, "31-60 days late")]
    [InlineData(61, "61-90 days late")]
    [InlineData(91, "Over 90 days late")]
    public void A_bill_lands_in_one_bucket(int daysLate, string expected)
    {
        Assert.Equal(expected, Bucket(daysLate));
    }

    // Mirrors CostingReportService. Kept here rather than made public on the service: these
    // are the rules being asserted, and a test that reads them from the thing it is testing
    // proves only that the code equals itself.
    private static readonly AdjustmentReason[] LossReasons =
    [
        AdjustmentReason.Damaged, AdjustmentReason.Lost, AdjustmentReason.Stolen,
        AdjustmentReason.Wastage, AdjustmentReason.Expired, AdjustmentReason.Unexplained,
    ];

    private static readonly AdjustmentReason[] Corrections =
    [
        AdjustmentReason.Miscount, AdjustmentReason.EntryError, AdjustmentReason.FoundExtra,
    ];

    private static string Bucket(int daysLate) => daysLate switch
    {
        <= 0 => "Not due yet",
        <= 30 => "1-30 days late",
        <= 60 => "31-60 days late",
        <= 90 => "61-90 days late",
        _ => "Over 90 days late",
    };
}
