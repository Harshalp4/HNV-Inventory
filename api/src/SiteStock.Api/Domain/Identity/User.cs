using SiteStock.Api.Domain.Common;

namespace SiteStock.Api.Domain.Identity;

/// <summary>
/// A person who can sign in. Note there is deliberately <b>no role column here</b> —
/// see <see cref="UserSiteRole"/>. One person can supervise two sites and do something
/// else at a third, and that is normal rather than exceptional.
/// </summary>
public class User : AuditableEntity
{
    public string FullName { get; set; } = string.Empty;

    /// <summary>Office staff sign in with this. Null for site staff who have no company email.</summary>
    public string? Email { get; set; }

    /// <summary>Ten-digit Indian mobile, stored without country code. Site staff sign in with this.</summary>
    public string PhoneNumber { get; set; } = string.Empty;

    public string PasswordHash { get; set; } = string.Empty;

    /// <summary>Set when an admin creates or resets the account; cleared on first change.</summary>
    public bool MustChangePassword { get; set; } = true;

    public bool IsActive { get; set; } = true;

    public DateTimeOffset? LastLoginAt { get; set; }

    /// <summary>Consecutive failed sign-ins. Reset on success.</summary>
    public int FailedLoginCount { get; set; }

    /// <summary>Set when <see cref="FailedLoginCount"/> passes the threshold.</summary>
    public DateTimeOffset? LockedOutUntil { get; set; }

    public ICollection<UserSiteRole> RoleAssignments { get; set; } = [];
    public ICollection<RefreshToken> RefreshTokens { get; set; } = [];

    public bool IsLockedOut(DateTimeOffset now) => LockedOutUntil is { } until && until > now;
}
