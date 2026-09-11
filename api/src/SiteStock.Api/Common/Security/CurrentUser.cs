using System.Security.Claims;

namespace SiteStock.Api.Common.Security;

public sealed class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private IReadOnlySet<string>? _permissions;
    private IReadOnlySet<Guid>? _siteIds;

    private ClaimsPrincipal? Principal => accessor.HttpContext?.User;

    public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated == true;

    public Guid Id =>
        Guid.TryParse(Principal?.FindFirstValue(AppClaims.UserId), out var id) ? id : Guid.Empty;

    public string FullName => Principal?.FindFirstValue(AppClaims.FullName) ?? string.Empty;

    public IReadOnlySet<string> Permissions =>
        _permissions ??= Principal?.FindAll(AppClaims.Permission)
                                   .Select(c => c.Value)
                                   .ToHashSet(StringComparer.Ordinal)
                         ?? new HashSet<string>(StringComparer.Ordinal);

    public IReadOnlySet<Guid> SiteIds =>
        _siteIds ??= Principal?.FindAll(AppClaims.Site)
                               .Select(c => Guid.TryParse(c.Value, out var g) ? g : Guid.Empty)
                               .Where(g => g != Guid.Empty)
                               .ToHashSet()
                     ?? new HashSet<Guid>();

    public bool HasAllSites =>
        string.Equals(Principal?.FindFirstValue(AppClaims.AllSites), "true", StringComparison.OrdinalIgnoreCase);

    public bool Can(string permission) => Permissions.Contains(permission);

    public bool CanSeeSite(Guid siteId) => HasAllSites || SiteIds.Contains(siteId);
}
