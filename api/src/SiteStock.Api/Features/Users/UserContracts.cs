namespace SiteStock.Api.Features.Users;

public record RoleAssignmentDto(Guid Id, string RoleCode, string RoleName, Guid? SiteId, string? SiteCode, string? SiteName);

public record UserListItem(
    Guid Id,
    string FullName,
    string? Email,
    string PhoneNumber,
    bool IsActive,
    bool IsLockedOut,
    DateTimeOffset? LastLoginAt,
    IReadOnlyList<RoleAssignmentDto> Roles);

public record UserDetail(
    Guid Id,
    string FullName,
    string? Email,
    string PhoneNumber,
    bool IsActive,
    bool MustChangePassword,
    bool IsLockedOut,
    DateTimeOffset? LockedOutUntil,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt,
    IReadOnlyList<RoleAssignmentDto> Roles);

public record CreateUserRequest(
    string FullName,
    string PhoneNumber,
    string? Email,
    string? Password,
    IReadOnlyList<AssignRoleRequest>? Roles);

public record UpdateUserRequest(string FullName, string PhoneNumber, string? Email);

/// <param name="SiteId">Required for site-scoped roles, must be null for organisation-wide ones.</param>
public record AssignRoleRequest(string RoleCode, Guid? SiteId);

public record ResetPasswordResponse(string TemporaryPassword);

public record RoleDto(
    Guid Id, string Code, string Name, string Description, string Scope, int SortOrder,
    IReadOnlyList<string> Permissions,
    /// <summary>Active people holding this role, counted across every site.</summary>
    int UserCount);

public record UserQuery
{
    /// <summary>Matches name, phone or email.</summary>
    public string? Q { get; init; }
    public string? Role { get; init; }
    public Guid? SiteId { get; init; }
    public bool? IsActive { get; init; }

    // Nullable on purpose: [AsParameters] treats a non-nullable value type as a *required*
    // query parameter, so `int Page = 1` would make ?page= mandatory rather than optional.
    public int? Page { get; init; }
    public int? PageSize { get; init; }
}
