using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Features.Users;

namespace SiteStock.Api.Tests;

/// <summary>
/// The permission map is the whole access-control model in one file, which makes it very
/// easy to widen by accident — someone adds a permission to a role in a hurry to unblock a
/// screen, and a control that the business depends on quietly disappears.
///
/// These tests assert what each role must <b>not</b> have. They are deliberately written as
/// business rules rather than as a copy of the map, so a change to the map that breaks a
/// rule fails here rather than in production.
/// </summary>
public class SeparationOfDutiesTests
{
    [Fact]
    public void PurchaseHead_cannot_approve_the_orders_he_prices()
    {
        var permissions = RolePermissions.For(RoleCode.PurchaseHead);

        Assert.Contains(Permissions.RequisitionsPrice, permissions);
        Assert.DoesNotContain(Permissions.PurchasesApprove, permissions);
    }

    [Fact]
    public void Owner_approves_but_does_not_price_or_receive()
    {
        var permissions = RolePermissions.For(RoleCode.Owner);

        Assert.Contains(Permissions.PurchasesApprove, permissions);
        Assert.DoesNotContain(Permissions.RequisitionsPrice, permissions);
        Assert.DoesNotContain(Permissions.GoodsReceive, permissions);
    }

    [Fact]
    public void Finance_releases_payment_but_cannot_approve_the_purchase()
    {
        var permissions = RolePermissions.For(RoleCode.FinanceManager);

        Assert.Contains(Permissions.PaymentsRelease, permissions);
        Assert.DoesNotContain(Permissions.PurchasesApprove, permissions);
    }

    [Fact]
    public void Admin_can_create_users_but_cannot_approve_or_pay()
    {
        var permissions = RolePermissions.For(RoleCode.Admin);

        Assert.Contains(Permissions.UsersManage, permissions);
        Assert.DoesNotContain(Permissions.PurchasesApprove, permissions);
        Assert.DoesNotContain(Permissions.PaymentsRelease, permissions);
        Assert.DoesNotContain(Permissions.BudgetsOverride, permissions);
    }

    [Fact]
    public void Only_the_owner_can_override_a_budget_block()
    {
        var withOverride = Enum.GetValues<RoleCode>()
            .Where(role => RolePermissions.For(role).Contains(Permissions.BudgetsOverride))
            .ToList();

        Assert.Equal([RoleCode.Owner], withOverride);
    }

    [Fact]
    public void Only_the_supervisor_receives_goods_and_records_consumption()
    {
        var receivers = Enum.GetValues<RoleCode>()
            .Where(role => RolePermissions.For(role).Contains(Permissions.GoodsReceive))
            .ToList();

        Assert.Equal([RoleCode.SiteSupervisor], receivers);
        Assert.Contains(Permissions.ConsumptionRecord, RolePermissions.For(RoleCode.SiteSupervisor));
    }

    [Fact]
    public void Supervisor_cannot_see_or_manage_staff_or_master_data()
    {
        var permissions = RolePermissions.For(RoleCode.SiteSupervisor);

        Assert.DoesNotContain(Permissions.UsersRead, permissions);
        Assert.DoesNotContain(Permissions.UsersManage, permissions);
        Assert.DoesNotContain(Permissions.CatalogManage, permissions);
        Assert.DoesNotContain(Permissions.SuppliersManage, permissions);
        Assert.DoesNotContain(Permissions.SitesManage, permissions);
    }

    [Fact]
    public void No_role_holds_a_permission_that_does_not_exist()
    {
        var declared = Permissions.All.ToHashSet();

        foreach (var (role, permissions) in RolePermissions.Table)
        {
            var unknown = permissions.Except(declared).ToList();
            Assert.True(unknown.Count == 0,
                $"{role} references undeclared permission(s): {string.Join(", ", unknown)}");
        }
    }

    [Fact]
    public void Every_role_has_at_least_one_permission()
    {
        foreach (var role in Enum.GetValues<RoleCode>())
        {
            Assert.True(RolePermissions.For(role).Count > 0, $"{role} would be able to do nothing.");
        }
    }

    [Fact]
    public void Combining_two_roles_grants_the_union_and_nothing_more()
    {
        // Somebody who supervises a site and also runs purchasing gets both sets — but this
        // is exactly how a separation-of-duties control gets defeated in practice, so the
        // combination is worth being able to reason about explicitly.
        var combined = RolePermissions.For([RoleCode.SiteSupervisor, RoleCode.PurchaseHead]);

        Assert.Contains(Permissions.GoodsReceive, combined);
        Assert.Contains(Permissions.RequisitionsPrice, combined);
        Assert.DoesNotContain(Permissions.PurchasesApprove, combined);
    }
}

/// <summary>
/// Work orders are the revenue side of the business. Who may see a client's contract value,
/// and who may change which job a purchase is costed against, are separate questions from
/// who may buy things.
/// </summary>
public class WorkOrderAccessTests
{
    [Fact]
    public void A_site_supervisor_never_sees_what_a_client_is_paying()
    {
        var permissions = RolePermissions.For(RoleCode.SiteSupervisor);

        Assert.DoesNotContain(Permissions.WorkOrdersRead, permissions);
        Assert.DoesNotContain(Permissions.WorkOrdersManage, permissions);
    }

    [Fact]
    public void Finance_reads_contracts_but_does_not_edit_them()
    {
        var permissions = RolePermissions.For(RoleCode.FinanceManager);

        Assert.Contains(Permissions.WorkOrdersRead, permissions);
        Assert.DoesNotContain(Permissions.WorkOrdersManage, permissions);
    }

    [Theory]
    [InlineData(RoleCode.Owner)]
    [InlineData(RoleCode.PurchaseHead)]
    [InlineData(RoleCode.Admin)]
    public void The_office_roles_can_set_which_job_a_purchase_belongs_to(RoleCode role)
    {
        var permissions = RolePermissions.For(role);

        Assert.Contains(Permissions.WorkOrdersRead, permissions);
        Assert.Contains(Permissions.WorkOrdersManage, permissions);
    }

    [Fact]
    public void Managing_contracts_does_not_come_with_approving_purchases()
    {
        // Costing a purchase to a job and approving the spend stay separate decisions.
        Assert.Contains(Permissions.WorkOrdersManage, RolePermissions.For(RoleCode.PurchaseHead));
        Assert.DoesNotContain(Permissions.PurchasesApprove, RolePermissions.For(RoleCode.PurchaseHead));

        Assert.Contains(Permissions.WorkOrdersManage, RolePermissions.For(RoleCode.Admin));
        Assert.DoesNotContain(Permissions.PurchasesApprove, RolePermissions.For(RoleCode.Admin));
    }
}

/// <summary>
/// Role permissions became editable, which moved the separation of duties out of code and
/// into data — so the tests above can only prove the system <i>ships</i> correct.
///
/// <para>What guards it afterwards is the warning raised at the moment somebody widens a
/// role. These assert that those warnings actually fire, because a warning that has quietly
/// stopped matching is worse than none: the screen still looks like it is watching.</para>
/// </summary>
/// <summary>
/// A site supervisor does not see what the company pays.
///
/// <para>He has to know what was ordered and from whom, or he cannot receive it at the gate.
/// He has no business knowing the rate. Before this split one permission covered both, and
/// every supervisor could read the margin off the requisition screen.</para>
/// </summary>
public class PriceVisibilityTests
{
    [Fact]
    public void A_site_supervisor_cannot_see_prices()
    {
        var permissions = RolePermissions.For(RoleCode.SiteSupervisor);

        // He still needs the order itself — this is the pair that has to stay split.
        Assert.Contains(Permissions.PurchaseOrdersRead, permissions);
        Assert.DoesNotContain(Permissions.PricesRead, permissions);
    }

    [Theory]
    [InlineData(RoleCode.PurchaseHead)]
    [InlineData(RoleCode.Owner)]
    [InlineData(RoleCode.FinanceManager)]
    [InlineData(RoleCode.Admin)]
    public void Everybody_in_the_office_still_does(RoleCode role)
    {
        Assert.Contains(Permissions.PricesRead, RolePermissions.For(role));
    }
}

public class PermissionWarningTests
{
    [Fact]
    public void Pricing_and_approving_in_one_role_is_called_out()
    {
        var warnings = RolePermissionEndpoints.WarningsFor(
            new HashSet<string> { Permissions.RequisitionsPrice, Permissions.PurchasesApprove });

        Assert.Contains(warnings, w => w.Title.Contains("price and approve"));
    }

    /// <summary>
    /// The rule that keeps the others honest. A warning that fires on the permissions the
    /// system ships with teaches people the warnings are noise, and then the one that
    /// matters goes unread too. This caught exactly that: an earlier draft flagged the site
    /// supervisor for receiving stock and correcting counts, which every supervisor does.
    /// </summary>

    [Fact]
    public void The_shipped_defaults_raise_no_warning_at_all()
    {
        foreach (var role in Enum.GetValues<RoleCode>())
        {
            var warnings = RolePermissionEndpoints.WarningsFor(RolePermissions.For(role).ToHashSet());
            Assert.True(warnings.Count == 0, $"{role} ships with a conflict: {string.Join("; ", warnings.Select(w => w.Title))}");
        }
    }
}
