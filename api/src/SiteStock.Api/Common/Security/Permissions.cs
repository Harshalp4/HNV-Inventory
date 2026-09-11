using System.Reflection;

namespace SiteStock.Api.Common.Security;

/// <summary>
/// The vocabulary of things a person can do. Endpoints require one of these, never a role
/// name — so "who is allowed to approve a purchase" is answered in exactly one place
/// (<see cref="RolePermissions"/>) and changing it does not mean touching endpoints.
///
/// Permissions for later phases are declared now so the map is reviewable as a whole,
/// even though nothing enforces them yet.
/// </summary>
public static class Permissions
{
    // ---- administration (Phase 1) ----
    public const string UsersRead        = "users.read";
    public const string UsersManage      = "users.manage";
    public const string SitesRead        = "sites.read";
    public const string SitesManage      = "sites.manage";
    public const string CatalogRead      = "catalog.read";
    public const string CatalogManage    = "catalog.manage";
    public const string SuppliersRead    = "suppliers.read";
    public const string SuppliersManage  = "suppliers.manage";
    public const string AuditRead        = "audit.read";
    public const string SettingsManage   = "settings.manage";
    public const string WorkOrdersRead   = "workorders.read";
    public const string WorkOrdersManage = "workorders.manage";

    // ---- procurement loop (Phase 1, later sprints) ----
    public const string RequisitionsCreate = "requisitions.create";
    public const string RequisitionsRead   = "requisitions.read";
    public const string RequisitionsPrice  = "requisitions.price";
    public const string PurchasesApprove   = "purchases.approve";
    public const string PurchaseOrdersRead = "purchaseorders.read";

    /// <summary>
    /// Rates, quotes and totals — the commercial side of a purchase.
    ///
    /// <para>Split from <see cref="PurchaseOrdersRead"/> on purpose. A site supervisor has to
    /// know what was ordered and from whom, or he cannot receive it at the gate; he has no
    /// business knowing what the company pays for it. Quantities and suppliers are site
    /// information, rates are commercial information, and one permission covering both meant
    /// every supervisor could read the margin off the screen.</para>
    /// </summary>
    public const string PricesRead = "prices.read";
    public const string PurchaseOrdersSend = "purchaseorders.send";
    public const string GoodsReceive       = "goods.receive";
    public const string GoodsRejectReview  = "goods.rejectreview";
    public const string StockRead          = "stock.read";
    public const string ConsumptionRecord  = "consumption.record";
    /// <summary>Correcting the books to a physical count. Deliberately narrow.</summary>
    public const string StockAdjust        = "stock.adjust";
    public const string TransfersManage    = "transfers.manage";

    // ---- money (Phase 2) ----
    public const string InvoicesEnter    = "invoices.enter";
    public const string InvoicesMatch    = "invoices.match";
    public const string PaymentsRelease  = "payments.release";
    public const string BudgetsRead      = "budgets.read";
    public const string BudgetsManage    = "budgets.manage";
    public const string BudgetsOverride  = "budgets.override";

    /// <summary>Every declared permission, discovered once at startup to register the policies.</summary>
    public static IReadOnlyList<string> All { get; } = typeof(Permissions)
        .GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
        .Where(f => f is { IsLiteral: true, IsInitOnly: false } && f.FieldType == typeof(string))
        .Select(f => (string)f.GetRawConstantValue()!)
        .OrderBy(x => x, StringComparer.Ordinal)
        .ToList();
}
