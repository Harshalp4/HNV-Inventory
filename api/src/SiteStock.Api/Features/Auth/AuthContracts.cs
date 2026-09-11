namespace SiteStock.Api.Features.Auth;

/// <param name="Login">Email address or ten-digit mobile number.</param>
public record LoginRequest(string Login, string Password);

public record RefreshRequest(string RefreshToken);

public record AuthResponse(
    string AccessToken,
    string RefreshToken,
    DateTimeOffset AccessTokenExpiresAt,
    CurrentUserResponse User);

public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public record SiteMembership(Guid Id, string Code, string Name);

public record RoleMembership(string Code, string Name, Guid? SiteId, string? SiteName);

/// <summary>
/// Everything the Angular app needs to draw the right navigation and hide the right
/// buttons. The buttons are a courtesy — the API enforces the same list independently.
/// </summary>
public record CurrentUserResponse(
    Guid Id,
    string FullName,
    string? Email,
    string PhoneNumber,
    bool MustChangePassword,
    IReadOnlyList<RoleMembership> Roles,
    IReadOnlyList<SiteMembership> Sites,
    bool HasAllSites,
    IReadOnlyList<string> Permissions);
