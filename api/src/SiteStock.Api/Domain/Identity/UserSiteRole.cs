using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Domain.Identity;

/// <summary>
/// One grant: this user holds this role, at this site (or organisation-wide when
/// <see cref="SiteId"/> is null and the role's scope allows it).
///
/// This table is the reason the plan insists on it over a role column on the user:
/// the real world has a supervisor at two sites, a purchase head across all of them,
/// and an owner who is not attached to any single one.
/// </summary>
public class UserSiteRole : AuditableEntity
{
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    public Guid RoleId { get; set; }
    public Role Role { get; set; } = null!;

    /// <summary>Null means organisation-wide. Only legal for roles with <see cref="RoleScope.Organisation"/>.</summary>
    public Guid? SiteId { get; set; }
    public Site? Site { get; set; }
}
