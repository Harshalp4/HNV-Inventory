namespace SiteStock.Api.Common.Security;

/// <summary>
/// The signed-in user, read from the token. Injected wherever a query needs to be
/// scoped — which, in this system, is nearly everywhere.
/// </summary>
public interface ICurrentUser
{
    bool IsAuthenticated { get; }
    Guid Id { get; }
    string FullName { get; }
    IReadOnlySet<string> Permissions { get; }
    IReadOnlySet<Guid> SiteIds { get; }

    /// <summary>True for organisation-wide roles (owner, finance, purchase head, admin).</summary>
    bool HasAllSites { get; }

    bool Can(string permission);

    /// <summary>
    /// Whether this user may see data belonging to <paramref name="siteId"/>.
    /// Call this — do not compare site lists by hand at the call site.
    /// </summary>
    bool CanSeeSite(Guid siteId);
}
