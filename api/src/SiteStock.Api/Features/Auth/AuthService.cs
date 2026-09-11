using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Auth;

public sealed class AuthService(
    SiteStockDbContext db,
    TokenService tokens,
    IPasswordHasher<User> hasher,
    TimeProvider clock,
    RolePermissionStore rolePermissions,
    ILogger<AuthService> logger)
{
    private const int MaxFailedAttempts = 5;
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    public async Task<AuthResponse> LoginAsync(
        LoginRequest request, string? ip, string? userAgent, CancellationToken ct)
    {
        var login = request.Login.Trim();

        var user = await Users()
            .FirstOrDefaultAsync(u => u.Email == login || u.PhoneNumber == login, ct);

        // Same message and roughly the same work either way: a caller must not be able to
        // discover which phone numbers are registered by timing or by reading the error.
        if (user is null)
        {
            hasher.HashPassword(new User(), request.Password);
            throw new AppException(401, "invalid_credentials", "That login or password is not correct.");
        }

        var now = clock.GetUtcNow();

        if (user.IsLockedOut(now))
        {
            throw new AppException(423, "account_locked",
                $"Too many failed attempts. Try again after {user.LockedOutUntil:HH:mm} UTC.");
        }

        if (!user.IsActive)
            throw new AppException(403, "account_inactive", "This account has been deactivated.");

        var verification = hasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);

        if (verification == PasswordVerificationResult.Failed)
        {
            user.FailedLoginCount++;
            if (user.FailedLoginCount >= MaxFailedAttempts)
            {
                user.LockedOutUntil = now.Add(LockoutDuration);
                logger.LogWarning("Locked out user {UserId} after {Count} failed attempts",
                    user.Id, user.FailedLoginCount);
            }
            await db.SaveChangesAsync(ct);
            throw new AppException(401, "invalid_credentials", "That login or password is not correct.");
        }

        if (verification == PasswordVerificationResult.SuccessRehashNeeded)
            user.PasswordHash = hasher.HashPassword(user, request.Password);

        if (user.RoleAssignments.Count == 0)
        {
            throw new AppException(403, "no_role_assigned",
                "This account has no role yet. Ask an administrator to assign one.");
        }

        user.FailedLoginCount = 0;
        user.LockedOutUntil = null;
        user.LastLoginAt = now;

        return await IssueAsync(user, ip, userAgent, ct);
    }

    public async Task<AuthResponse> RefreshAsync(
        string refreshToken, string? ip, string? userAgent, CancellationToken ct)
    {
        var hash = TokenService.Hash(refreshToken);
        var now = clock.GetUtcNow();

        var stored = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct);

        if (stored is null)
            throw new AppException(401, "invalid_refresh_token", "Please sign in again.");

        // A token presented after it was already rotated means either a replay or a stolen
        // token. Either way the safe move is to cut the whole family, not just this one.
        if (stored.RevokedAt is not null)
        {
            logger.LogWarning("Reuse of a revoked refresh token for user {UserId}. Revoking all sessions.",
                stored.UserId);
            await RevokeAllForUserAsync(stored.UserId, now, ct);
            throw new AppException(401, "invalid_refresh_token", "Please sign in again.");
        }

        if (!stored.IsActive(now))
            throw new AppException(401, "invalid_refresh_token", "Your session has expired. Please sign in again.");

        var user = await Users().FirstOrDefaultAsync(u => u.Id == stored.UserId, ct)
                   ?? throw new AppException(401, "invalid_refresh_token", "Please sign in again.");

        if (!user.IsActive)
            throw new AppException(403, "account_inactive", "This account has been deactivated.");

        var response = await IssueAsync(user, ip, userAgent, ct, rotating: stored);
        return response;
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken ct)
    {
        var hash = TokenService.Hash(refreshToken);
        var stored = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (stored is null || stored.RevokedAt is not null) return;

        stored.RevokedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
    }

    public async Task ChangePasswordAsync(Guid userId, ChangePasswordRequest request, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct)
                   ?? throw new AppException(404, "user_not_found", "User not found.");

        if (hasher.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword)
            == PasswordVerificationResult.Failed)
        {
            throw new AppException(400, "wrong_password", "Your current password is not correct.");
        }

        PasswordRules.Validate(request.NewPassword);

        user.PasswordHash = hasher.HashPassword(user, request.NewPassword);
        user.MustChangePassword = false;

        // Changing a password ends every other session. That is the behaviour someone
        // expects when they change it *because* they think it was compromised.
        await RevokeAllForUserAsync(user.Id, clock.GetUtcNow(), ct);
        await db.SaveChangesAsync(ct);
    }

    public async Task<CurrentUserResponse> DescribeAsync(Guid userId, CancellationToken ct)
    {
        var user = await Users().FirstOrDefaultAsync(u => u.Id == userId, ct)
                   ?? throw new AppException(404, "user_not_found", "User not found.");
        return Describe(user);
    }

    // ---- helpers ----

    private IQueryable<User> Users() => db.Users
        .Include(u => u.RoleAssignments).ThenInclude(a => a.Role)
        .Include(u => u.RoleAssignments).ThenInclude(a => a.Site);

    private async Task<AuthResponse> IssueAsync(
        User user, string? ip, string? userAgent, CancellationToken ct, RefreshToken? rotating = null)
    {
        var assignments = user.RoleAssignments.ToList();
        var (accessToken, expiresAt) = tokens.CreateAccessToken(user, assignments);
        var (refreshToken, refreshHash, refreshExpiry) = tokens.CreateRefreshToken();

        var stored = new RefreshToken
        {
            UserId = user.Id,
            TokenHash = refreshHash,
            CreatedAt = clock.GetUtcNow(),
            ExpiresAt = refreshExpiry,
            CreatedByIp = ip,
            UserAgent = userAgent?[..Math.Min(userAgent.Length, 300)],
        };

        db.RefreshTokens.Add(stored);

        if (rotating is not null)
        {
            rotating.RevokedAt = clock.GetUtcNow();
            rotating.ReplacedByTokenId = stored.Id;
        }

        await db.SaveChangesAsync(ct);

        return new AuthResponse(accessToken, refreshToken, expiresAt, Describe(user));
    }

    private async Task RevokeAllForUserAsync(Guid userId, DateTimeOffset now, CancellationToken ct)
    {
        await db.RefreshTokens
            .Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);
    }

    /// <summary>Instance rather than static: the permissions now come from the store.</summary>
    internal CurrentUserResponse Describe(User user)
    {
        var assignments = user.RoleAssignments.ToList();
        var roleCodes = assignments.Select(a => a.Role.Code).Distinct().ToList();
        var hasAllSites = assignments.Any(a => a.Role.Scope == RoleScope.Organisation);

        return new CurrentUserResponse(
            user.Id,
            user.FullName,
            user.Email,
            user.PhoneNumber,
            user.MustChangePassword,
            assignments
                .OrderBy(a => a.Role.SortOrder)
                .Select(a => new RoleMembership(a.Role.Code.ToString(), a.Role.Name, a.SiteId, a.Site?.Name))
                .ToList(),
            assignments
                .Where(a => a.Site is not null)
                .Select(a => a.Site!)
                .DistinctBy(s => s.Id)
                .OrderBy(s => s.Name)
                .Select(s => new SiteMembership(s.Id, s.Code, s.Name))
                .ToList(),
            hasAllSites,
            rolePermissions.For(roleCodes).OrderBy(p => p, StringComparer.Ordinal).ToList());
    }
}
