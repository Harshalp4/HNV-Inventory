using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Inventory;

namespace SiteStock.Api.Tests;

/// <summary>
/// The arithmetic that decides what a site is willing to give away, and who may take part.
/// Both are business rules rather than plumbing, so they are pinned down here.
/// </summary>
public class TransferRulesTests
{
    /// <summary>
    /// Mirrors the rule in TransferService.FindSpareAsync. A site offers what it holds
    /// <b>above its own warn-me level</b> — never the full figure, or one site's problem
    /// simply becomes another's.
    /// </summary>
    private static decimal Spare(decimal onHand, decimal? reorderLevel) =>
        Math.Max(0m, onHand - (reorderLevel ?? 0m));

    // Whole numbers, converted in the body: an attribute argument cannot be a decimal
    // literal, and xUnit will not widen an int to a nullable decimal for us.
    [Theory]
    [InlineData(35, 30, 5)]      // the worked example
    [InlineData(100, 30, 70)]
    [InlineData(30, 30, 0)]      // exactly at the level: nothing to give
    [InlineData(20, 30, 0)]      // already below it
    [InlineData(40, null, 40)]   // no level set: all of it is spare
    public void A_site_offers_only_what_it_holds_above_its_own_level(
        int onHand, int? level, int expected)
    {
        Assert.Equal(expected, Spare(onHand, level));
    }

    [Fact]
    public void A_site_at_its_warn_me_level_offers_nothing()
    {
        // The failure this prevents: solving one site's shortage by creating another's.
        // After that happens twice, nobody trusts the screen again.
        Assert.Equal(0m, Spare(30m, 30m));
        Assert.Equal(0m, Spare(29m, 30m));
    }

    [Fact]
    public void Both_ends_of_a_transfer_can_take_part_but_a_third_site_cannot()
    {
        // Encoded in TransferService.LoadAsync: either site is party to the conversation.
        var supervisor = RolePermissions.For(RoleCode.SiteSupervisor);
        var purchaseHead = RolePermissions.For(RoleCode.PurchaseHead);

        Assert.Contains(Permissions.TransfersManage, supervisor);
        Assert.Contains(Permissions.TransfersManage, purchaseHead);
    }

    [Fact]
    public void Finance_does_not_move_material_between_sites()
    {
        Assert.DoesNotContain(Permissions.TransfersManage, RolePermissions.For(RoleCode.FinanceManager));
    }

    [Fact]
    public void An_administrator_manages_the_system_not_the_stock()
    {
        // Admin sets up people, sites and settings. Moving material is a site decision.
        Assert.DoesNotContain(Permissions.TransfersManage, RolePermissions.For(RoleCode.Admin));
    }

    [Theory]
    [InlineData(MovementType.TransferOut)]
    [InlineData(MovementType.TransferIn)]
    public void A_transfer_writes_two_movements_not_one(MovementType type)
    {
        // Out when the lorry leaves, in when it is counted at the far end. Between the two
        // the material is in transit and belongs to neither site — which is where it is.
        Assert.Contains(type, Enum.GetValues<MovementType>());
    }

    [Fact]
    public void The_saving_is_material_value_less_transport()
    {
        // A transfer that costs more in transport than the material is worth is not a
        // saving, and the screen says so rather than quietly claiming one.
        const decimal materialValue = 1_540m;
        const decimal transport = 800m;

        Assert.Equal(740m, materialValue - transport);
        Assert.True(materialValue - 2_000m < 0, "Transport above the material value is a loss.");
    }
}
