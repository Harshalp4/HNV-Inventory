using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Paging;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Users;

public sealed class UserService(
    SiteStockDbContext db,
    IPasswordHasher<User> hasher,
    ICurrentUser currentUser,
    RolePermissionStore rolePermissions,
    TimeProvider clock)
{
    public async Task<PagedResult<UserListItem>> ListAsync(UserQuery query, CancellationToken ct)
    {
        var page = new PageRequest { Page = query.Page ?? 1, PageSize = query.PageSize ?? 25 };

        var users = db.Users
            .Include(u => u.RoleAssignments).ThenInclude(a => a.Role)
            .Include(u => u.RoleAssignments).ThenInclude(a => a.Site)
            .AsNoTracking()
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var term = $"%{query.Q.Trim()}%";
            users = users.Where(u =>
                EF.Functions.ILike(u.FullName, term) ||
                EF.Functions.ILike(u.PhoneNumber, term) ||
                (u.Email != null && EF.Functions.ILike(u.Email, term)));
        }

        if (!string.IsNullOrWhiteSpace(query.Role) && Enum.TryParse<RoleCode>(query.Role, true, out var roleCode))
            users = users.Where(u => u.RoleAssignments.Any(a => a.Role.Code == roleCode));

        if (query.SiteId is { } siteId)
            users = users.Where(u => u.RoleAssignments.Any(a => a.SiteId == siteId));

        if (query.IsActive is { } active)
            users = users.Where(u => u.IsActive == active);

        // An administrator who only administers two sites should not be able to enumerate
        // the whole organisation's staff. Organisation-wide roles see everyone.
        if (!currentUser.HasAllSites)
        {
            var permitted = currentUser.SiteIds.ToList();
            users = users.Where(u => u.RoleAssignments.Any(a => a.SiteId != null && permitted.Contains(a.SiteId!.Value)));
        }

        var total = await users.CountAsync(ct);
        var now = clock.GetUtcNow();

        var items = await users
            .OrderBy(u => u.FullName)
            .Skip(page.Skip).Take(page.SafePageSize)
            .ToListAsync(ct);

        return new PagedResult<UserListItem>(
            items.Select(u => new UserListItem(
                u.Id, u.FullName, u.Email, u.PhoneNumber, u.IsActive,
                u.IsLockedOut(now), u.LastLoginAt, Map(u.RoleAssignments))).ToList(),
            page.SafePage, page.SafePageSize, total);
    }

    public async Task<UserDetail> GetAsync(Guid id, CancellationToken ct)
    {
        var user = await Load(id, ct);
        var now = clock.GetUtcNow();

        return new UserDetail(
            user.Id, user.FullName, user.Email, user.PhoneNumber, user.IsActive,
            user.MustChangePassword, user.IsLockedOut(now), user.LockedOutUntil,
            user.LastLoginAt, user.CreatedAt, Map(user.RoleAssignments));
    }

    public async Task<(UserDetail User, string? TemporaryPassword)> CreateAsync(
        CreateUserRequest request, CancellationToken ct)
    {
        var phone = request.PhoneNumber.Trim();
        var email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim().ToLowerInvariant();

        if (await db.Users.AnyAsync(u => u.PhoneNumber == phone, ct))
            throw AppException.Conflict("phone_in_use", "Another user already has that mobile number.");

        if (email is not null && await db.Users.AnyAsync(u => u.Email == email, ct))
            throw AppException.Conflict("email_in_use", "Another user already has that email address.");

        var generated = string.IsNullOrWhiteSpace(request.Password) ? GeneratePassword() : null;
        var password = generated ?? request.Password!;
        PasswordRules.Validate(password);

        var user = new User
        {
            FullName = request.FullName.Trim(),
            PhoneNumber = phone,
            Email = email,
            IsActive = true,
            MustChangePassword = true,
        };
        user.PasswordHash = hasher.HashPassword(user, password);

        db.Users.Add(user);

        foreach (var assignment in request.Roles ?? [])
            db.UserSiteRoles.Add(await BuildAssignmentAsync(user, assignment, ct));

        await db.SaveChangesAsync(ct);

        return (await GetAsync(user.Id, ct), generated);
    }

    public async Task<UserDetail> UpdateAsync(Guid id, UpdateUserRequest request, CancellationToken ct)
    {
        var user = await Load(id, ct);

        var phone = request.PhoneNumber.Trim();
        var email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim().ToLowerInvariant();

        if (await db.Users.AnyAsync(u => u.PhoneNumber == phone && u.Id != id, ct))
            throw AppException.Conflict("phone_in_use", "Another user already has that mobile number.");

        if (email is not null && await db.Users.AnyAsync(u => u.Email == email && u.Id != id, ct))
            throw AppException.Conflict("email_in_use", "Another user already has that email address.");

        user.FullName = request.FullName.Trim();
        user.PhoneNumber = phone;
        user.Email = email;

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<UserDetail> SetActiveAsync(Guid id, bool active, CancellationToken ct)
    {
        var user = await Load(id, ct);

        // Deactivating yourself is always a mistake, and it is one that needs another
        // administrator to undo.
        if (!active && user.Id == currentUser.Id)
            throw AppException.BadRequest("cannot_deactivate_self", "You cannot deactivate your own account.");

        if (!active && await IsLastActiveAdminAsync(user, ct))
            throw AppException.BadRequest("last_admin",
                "This is the last active administrator. Give someone else the role first.");

        user.IsActive = active;
        if (active)
        {
            user.LockedOutUntil = null;
            user.FailedLoginCount = 0;
        }
        else
        {
            // Deactivation must end sessions immediately, or the person keeps working for
            // up to fifteen minutes on an access token that was already issued.
            await db.RefreshTokens
                .Where(t => t.UserId == id && t.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, clock.GetUtcNow()), ct);
        }

        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<ResetPasswordResponse> ResetPasswordAsync(Guid id, CancellationToken ct)
    {
        var user = await Load(id, ct);
        var password = GeneratePassword();

        user.PasswordHash = hasher.HashPassword(user, password);
        user.MustChangePassword = true;
        user.FailedLoginCount = 0;
        user.LockedOutUntil = null;

        await db.RefreshTokens
            .Where(t => t.UserId == id && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, clock.GetUtcNow()), ct);

        await db.SaveChangesAsync(ct);
        return new ResetPasswordResponse(password);
    }

    public async Task<UserDetail> AddRoleAsync(Guid id, AssignRoleRequest request, CancellationToken ct)
    {
        var user = await Load(id, ct);
        var assignment = await BuildAssignmentAsync(user, request, ct);

        var duplicate = user.RoleAssignments.Any(a =>
            a.RoleId == assignment.RoleId && a.SiteId == assignment.SiteId);

        if (duplicate)
            throw AppException.Conflict("already_assigned", "This user already holds that role there.");

        db.UserSiteRoles.Add(assignment);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<UserDetail> RemoveRoleAsync(Guid id, Guid assignmentId, CancellationToken ct)
    {
        var user = await Load(id, ct);

        var assignment = user.RoleAssignments.FirstOrDefault(a => a.Id == assignmentId)
                         ?? throw AppException.NotFound("That role assignment");

        if (assignment.Role.Code == RoleCode.Admin && await IsLastActiveAdminAsync(user, ct))
            throw AppException.BadRequest("last_admin",
                "This is the last active administrator. Give someone else the role first.");

        if (user.RoleAssignments.Count == 1)
            throw AppException.BadRequest("last_role",
                "A user needs at least one role. Add the replacement first, then remove this one.");

        db.UserSiteRoles.Remove(assignment);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<IReadOnlyList<RoleDto>> ListRolesAsync(CancellationToken ct)
    {
        var roles = await db.Roles.AsNoTracking().OrderBy(r => r.SortOrder).ToListAsync(ct);

        // Distinct people, not assignments: Santosh supervising two sites is one supervisor,
        // and "2 people hold this" would be wrong on the screen that decides who can do what.
        var holders = await db.UserSiteRoles.AsNoTracking()
            .Where(a => a.User.IsActive)
            .Select(a => new { a.RoleId, a.UserId })
            .Distinct()
            .GroupBy(a => a.RoleId)
            .Select(g => new { RoleId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.RoleId, x => x.Count, ct);

        return roles.Select(r => new RoleDto(
            r.Id, r.Code.ToString(), r.Name, r.Description, r.Scope.ToString(), r.SortOrder,
            rolePermissions.For(r.Code).OrderBy(p => p, StringComparer.Ordinal).ToList(),
            holders.GetValueOrDefault(r.Id))).ToList();
    }

    // ---- helpers ----

    private async Task<User> Load(Guid id, CancellationToken ct) =>
        await db.Users
            .Include(u => u.RoleAssignments).ThenInclude(a => a.Role)
            .Include(u => u.RoleAssignments).ThenInclude(a => a.Site)
            .FirstOrDefaultAsync(u => u.Id == id, ct)
        ?? throw AppException.NotFound("That user");

    private async Task<UserSiteRole> BuildAssignmentAsync(
        User user, AssignRoleRequest request, CancellationToken ct)
    {
        if (!Enum.TryParse<RoleCode>(request.RoleCode, true, out var code))
            throw AppException.BadRequest("unknown_role", $"There is no role called '{request.RoleCode}'.");

        var role = await db.Roles.FirstOrDefaultAsync(r => r.Code == code, ct)
                   ?? throw AppException.NotFound("That role");

        // The scope rule is what keeps the data honest: a supervisor without a site is
        // meaningless, and an owner attached to one site is misleading.
        if (role.Scope == RoleScope.SiteScoped && request.SiteId is null)
            throw AppException.BadRequest("site_required",
                $"{role.Name} is a site role — choose which site.");

        if (role.Scope == RoleScope.Organisation && request.SiteId is not null)
            throw AppException.BadRequest("site_not_allowed",
                $"{role.Name} applies to the whole company, so it is not attached to a site.");

        if (request.SiteId is { } siteId && !await db.Sites.AnyAsync(s => s.Id == siteId, ct))
            throw AppException.NotFound("That site");

        return new UserSiteRole { User = user, UserId = user.Id, RoleId = role.Id, SiteId = request.SiteId };
    }

    private async Task<bool> IsLastActiveAdminAsync(User user, CancellationToken ct)
    {
        var isAdmin = user.RoleAssignments.Any(a => a.Role.Code == RoleCode.Admin);
        if (!isAdmin) return false;

        var activeAdmins = await db.Users.CountAsync(
            u => u.IsActive && u.RoleAssignments.Any(a => a.Role.Code == RoleCode.Admin), ct);

        return activeAdmins <= 1;
    }

    /// <summary>
    /// Readable over a phone call, because that is how it will actually be delivered.
    /// No ambiguous characters, and the user must change it on first sign-in anyway.
    /// </summary>
    private static string GeneratePassword()
    {
        const string letters = "abcdefghjkmnpqrstuvwxyz";
        const string upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
        const string digits = "23456789";

        var chars = new char[10];
        chars[0] = upper[RandomNumberGenerator.GetInt32(upper.Length)];
        for (var i = 1; i < 7; i++) chars[i] = letters[RandomNumberGenerator.GetInt32(letters.Length)];
        for (var i = 7; i < 10; i++) chars[i] = digits[RandomNumberGenerator.GetInt32(digits.Length)];
        return new string(chars);
    }

    private static List<RoleAssignmentDto> Map(IEnumerable<UserSiteRole> assignments) =>
        assignments
            .OrderBy(a => a.Role.SortOrder).ThenBy(a => a.Site?.Name)
            .Select(a => new RoleAssignmentDto(
                a.Id, a.Role.Code.ToString(), a.Role.Name, a.SiteId, a.Site?.Code, a.Site?.Name))
            .ToList();
}
