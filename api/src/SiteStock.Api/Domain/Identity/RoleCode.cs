namespace SiteStock.Api.Domain.Identity;

/// <summary>
/// The five roles from the specification. Stored as a short string on <see cref="Role"/>
/// so the database stays readable, but referenced in code through this enum.
/// </summary>
public enum RoleCode
{
    SiteSupervisor = 1,
    PurchaseHead = 2,
    Owner = 3,
    FinanceManager = 4,
    Admin = 5,
}

/// <summary>
/// Whether a role assignment is meaningful per site or only organisation-wide.
/// A supervisor supervises *a site*; an owner owns the company.
/// </summary>
public enum RoleScope
{
    /// <summary>Assignment must name a site.</summary>
    SiteScoped = 1,

    /// <summary>Assignment covers the whole organisation; site must be null.</summary>
    Organisation = 2,
}
