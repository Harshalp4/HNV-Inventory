using SiteStock.Api.Domain.Identity;

namespace SiteStock.Api.Common.Security;

/// <summary>
/// What each role may do <b>when the system is first installed</b>, and what "Put back to the
/// original" restores. This is the file to read in a review meeting — the permission table
/// from the specification, in code.
///
/// <para>Note what is deliberately absent from the defaults: the purchase head cannot approve
/// his own pricing, and the supervisor cannot price a requisition. Separation of duties is the
/// point of the whole workflow.</para>
///
/// <para><b>This is no longer what is enforced at runtime.</b> Live permissions are rows in
/// <c>role_permissions</c>, seeded from here and editable on the Roles screen — read them
/// through <see cref="RolePermissionStore"/>. Which means the tests below prove the system
/// ships correct; they cannot prove it stayed that way. What protects it after that is the
/// warning shown at the moment of the change, the refusal to remove the last administrator,
/// and the audit row naming who widened what.</para>
/// </summary>
public static class RolePermissions
{
    private static readonly Dictionary<RoleCode, string[]> Map = new()
    {
        [RoleCode.SiteSupervisor] =
        [
            Permissions.RequisitionsCreate, Permissions.RequisitionsRead,
            Permissions.PurchaseOrdersRead,
            Permissions.GoodsReceive,
            Permissions.StockRead, Permissions.ConsumptionRecord, Permissions.StockAdjust,
            // A supervisor asks another site for material, and answers when asked.
            Permissions.TransfersManage,
            Permissions.CatalogRead, Permissions.SitesRead, Permissions.SuppliersRead,
        ],

        [RoleCode.PurchaseHead] =
        [
            // Can raise a request on a site's behalf — a phone call from a supervisor
            // still has to become a record. He prices it too, which is fine: the owner
            // is the one who approves, and that is where the control actually sits.
            Permissions.RequisitionsCreate,
            Permissions.RequisitionsRead, Permissions.RequisitionsPrice,
            Permissions.PurchaseOrdersRead, Permissions.PurchaseOrdersSend, Permissions.PricesRead,
            Permissions.GoodsRejectReview,
            Permissions.StockRead, Permissions.TransfersManage,
            Permissions.CatalogRead, Permissions.CatalogManage,
            Permissions.SuppliersRead, Permissions.SuppliersManage,
            Permissions.SitesRead, Permissions.BudgetsRead,
            Permissions.WorkOrdersRead, Permissions.WorkOrdersManage,
        ],

        [RoleCode.Owner] =
        [
            // The owner can raise a request as well as approve one. In a company this size
            // that is normal — but when the same person does both, the timeline says so,
            // rather than leaving it to be discovered later.
            Permissions.RequisitionsCreate,
            Permissions.RequisitionsRead,
            Permissions.PurchasesApprove,
            Permissions.PurchaseOrdersRead, Permissions.PricesRead,
            Permissions.StockRead,
            Permissions.BudgetsRead, Permissions.BudgetsOverride,
            // The owner can add a material. Keeping the master list clean is a real concern,
            // but it is not a separation-of-duties one: somebody who can override a budget
            // is not the risk a locked catalogue was protecting against, and being unable
            // to name a material stalls the request he is standing there approving.
            Permissions.CatalogRead, Permissions.CatalogManage,
            Permissions.SuppliersRead, Permissions.SitesRead,
            Permissions.UsersRead, Permissions.AuditRead,
            Permissions.WorkOrdersRead, Permissions.WorkOrdersManage,
            // In a company this size the owner is also the one who pays the suppliers. That
            // is the same person approving the spend and releasing the money, which is a
            // real weakening of the separation the rest of this workflow exists to keep —
            // but pretending otherwise means the bills never get entered at all. The
            // timeline records who did both. Move these to a finance role from the Roles
            // screen the moment somebody is hired to do the books.
            Permissions.InvoicesEnter, Permissions.InvoicesMatch, Permissions.PaymentsRelease,
        ],

        [RoleCode.FinanceManager] =
        [
            Permissions.PurchaseOrdersRead, Permissions.PricesRead, Permissions.RequisitionsRead,
            Permissions.StockRead,
            Permissions.InvoicesEnter, Permissions.InvoicesMatch, Permissions.PaymentsRelease,
            Permissions.BudgetsRead, Permissions.BudgetsManage,
            Permissions.SuppliersRead, Permissions.CatalogRead, Permissions.SitesRead,
            Permissions.AuditRead,
            // Finance reads the contracts to see margin, but does not edit them.
            Permissions.WorkOrdersRead,
        ],

        // Admin runs the system, and deliberately does *not* get the approval or payment
        // permissions. Somebody who can create users should not also be able to release money.
        [RoleCode.Admin] =
        [
            Permissions.RequisitionsCreate,
            Permissions.UsersRead, Permissions.UsersManage,
            Permissions.SitesRead, Permissions.SitesManage,
            Permissions.CatalogRead, Permissions.CatalogManage,
            Permissions.SuppliersRead, Permissions.SuppliersManage,
            Permissions.AuditRead,
            Permissions.SettingsManage,
            Permissions.WorkOrdersRead, Permissions.WorkOrdersManage,
            Permissions.RequisitionsRead, Permissions.PurchaseOrdersRead, Permissions.PricesRead,
            Permissions.StockRead,
        ],
    };

    public static IReadOnlySet<string> For(RoleCode role) =>
        Map.TryGetValue(role, out var perms) ? perms.ToHashSet() : new HashSet<string>();

    public static IReadOnlySet<string> For(IEnumerable<RoleCode> roles)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var role in roles) set.UnionWith(For(role));
        return set;
    }

    public static IReadOnlyDictionary<RoleCode, string[]> Table => Map;
}
