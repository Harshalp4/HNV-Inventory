using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Users;

public record SaveRolePermissionsRequest(IReadOnlyList<string> Permissions);

/// <summary>A combination that is allowed but undoes the point of the workflow.</summary>
public record PermissionWarning(string Title, string Detail);

public record SaveRolePermissionsResponse(
    string RoleCode, IReadOnlyList<string> Permissions, IReadOnlyList<PermissionWarning> Warnings);

public static class RolePermissionEndpoints
{
    /// <summary>
    /// Combinations that are not refused, but are said out loud.
    ///
    /// <para>Refusing them would be wrong: it is the company's own separation of duties, and
    /// at four people somebody may genuinely have to both price and approve. But it should
    /// never happen by accident, so it comes back named, and the audit trail records that it
    /// was chosen.</para>
    ///
    /// <para>There is exactly one, and the list is short on purpose. A first draft had four,
    /// and a test that asserts the shipped defaults raise no warning failed on three of them:
    /// the finance manager already enters bills and releases payment, the owner already
    /// raises and approves, and the supervisor already receives stock and corrects the count.
    /// All three are deliberate at a company this size. Warning about the defaults would
    /// teach everybody that these warnings are noise, and then the one that matters goes
    /// unread too — so what is left is the single separation this workflow genuinely
    /// depends on.</para>
    /// </summary>
    private static readonly (string A, string B, string Title, string Detail)[] Conflicts =
    [
        (Permissions.RequisitionsPrice, Permissions.PurchasesApprove,
            "The same role can now price and approve",
            "Whoever holds this role can choose the supplier and the rate, then approve their own choice. Nobody else sees it in between."),

        // Raising and approving is also not here: the owner ships with both, on purpose, and
        // the requisition itself already carries "raised and approved by the same person" on
        // its own timeline — which is the place that fact is actually useful.

        // Receiving and adjusting is deliberately NOT on this list, though it looks like it
        // belongs. The supervisor is the only person at the gate — requiring a second pair
        // of eyes to correct a count would stop work, and the control that actually applies
        // is elsewhere: an adjustment is an immutable ledger row with a typed reason against
        // the name of whoever made it. Warning about the shipped defaults would teach people
        // that these warnings are noise, which is how the real ones stop being read.
    ];

    public static IEndpointRouteBuilder MapRolePermissionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/permissions", () => Results.Ok(Permissions.All))
            .RequirePermission(Permissions.UsersRead)
            .WithTags("Users").WithName("ListPermissions")
            .WithSummary("Every permission the system understands.");

        app.MapPut("/api/roles/{code}/permissions", async (
                string code,
                SaveRolePermissionsRequest request,
                SiteStockDbContext db,
                RolePermissionStore store,
                ICurrentUser me,
                TimeProvider clock,
                ILogger<RolePermission> logger,
                CancellationToken ct) =>
            {
                if (!Enum.TryParse<RoleCode>(code, ignoreCase: true, out var roleCode))
                    throw AppException.NotFound("That role");

                var role = await db.Roles.FirstOrDefaultAsync(r => r.Code == roleCode, ct)
                           ?? throw AppException.NotFound("That role");

                var wanted = request.Permissions
                    .Select(p => p.Trim())
                    .Where(p => p.Length > 0)
                    .Distinct(StringComparer.Ordinal)
                    .ToHashSet(StringComparer.Ordinal);

                var unknown = wanted.Where(p => !Permissions.All.Contains(p)).ToList();
                if (unknown.Count > 0)
                {
                    throw AppException.BadRequest("unknown_permission",
                        $"Not a permission this system knows: {string.Join(", ", unknown)}.");
                }

                // ── the one rule that cannot be waived ───────────────────────
                //
                // Somebody has to be able to get back in and undo a mistake. Without this a
                // single wrong save locks every administrator out of the screen that would
                // let them fix it, and the only way back is a database console.
                await EnsureSomebodyCanStillManageUsersAsync(db, role, wanted, ct);

                var existing = await db.RolePermissions.Where(rp => rp.RoleId == role.Id).ToListAsync(ct);
                var before = existing.Select(rp => rp.Permission).ToHashSet(StringComparer.Ordinal);

                if (before.SetEquals(wanted))
                {
                    return Results.Ok(new SaveRolePermissionsResponse(
                        role.Code.ToString(), wanted.OrderBy(p => p, StringComparer.Ordinal).ToList(),
                        WarningsFor(wanted)));
                }

                db.RolePermissions.RemoveRange(existing.Where(rp => !wanted.Contains(rp.Permission)));

                foreach (var permission in wanted.Where(p => !before.Contains(p)))
                {
                    db.RolePermissions.Add(new RolePermission { RoleId = role.Id, Permission = permission });
                }

                var added = wanted.Except(before).OrderBy(p => p, StringComparer.Ordinal).ToList();
                var removed = before.Except(wanted).OrderBy(p => p, StringComparer.Ordinal).ToList();

                db.AuditLog.Add(Entry(role, me, clock,
                    $"{role.Name}: " +
                    (added.Count > 0 ? $"granted {string.Join(", ", added)}. " : string.Empty) +
                    (removed.Count > 0 ? $"withdrew {string.Join(", ", removed)}." : string.Empty)));

                await db.SaveChangesAsync(ct);
                store.Invalidate();

                logger.LogWarning(
                    "{Actor} changed {Role} permissions — granted [{Added}], withdrew [{Removed}]",
                    me.FullName, role.Code, string.Join(", ", added), string.Join(", ", removed));

                return Results.Ok(new SaveRolePermissionsResponse(
                    role.Code.ToString(),
                    wanted.OrderBy(p => p, StringComparer.Ordinal).ToList(),
                    WarningsFor(wanted)));
            })
            .RequirePermission(Permissions.UsersManage)
            .WithTags("Users").WithName("SaveRolePermissions")
            .WithSummary("Replaces everything a role may do. Takes effect on the next token refresh.");

        app.MapPost("/api/roles/{code}/permissions/reset", async (
                string code, SiteStockDbContext db, RolePermissionStore store,
                ICurrentUser me, TimeProvider clock, CancellationToken ct) =>
            {
                if (!Enum.TryParse<RoleCode>(code, ignoreCase: true, out var roleCode))
                    throw AppException.NotFound("That role");

                var role = await db.Roles.FirstOrDefaultAsync(r => r.Code == roleCode, ct)
                           ?? throw AppException.NotFound("That role");

                var defaults = RolePermissions.For(roleCode).ToHashSet(StringComparer.Ordinal);
                await EnsureSomebodyCanStillManageUsersAsync(db, role, defaults, ct);

                var existing = await db.RolePermissions.Where(rp => rp.RoleId == role.Id).ToListAsync(ct);
                db.RolePermissions.RemoveRange(existing);

                foreach (var permission in defaults)
                {
                    db.RolePermissions.Add(new RolePermission { RoleId = role.Id, Permission = permission });
                }

                db.AuditLog.Add(Entry(role, me, clock,
                    $"{role.Name} put back to the permissions it shipped with."));

                await db.SaveChangesAsync(ct);
                store.Invalidate();

                return Results.Ok(new SaveRolePermissionsResponse(
                    role.Code.ToString(),
                    defaults.OrderBy(p => p, StringComparer.Ordinal).ToList(),
                    WarningsFor(defaults)));
            })
            .RequirePermission(Permissions.UsersManage)
            .WithTags("Users").WithName("ResetRolePermissions")
            .WithSummary("Puts a role back to the permissions it shipped with.");

        return app;
    }

    /// <summary>
    /// A change to who may approve spending is exactly the row somebody will want to find in
    /// a year, so it is written with the before-and-after in words rather than a diff of ids.
    /// </summary>
    private static Domain.Auditing.AuditLogEntry Entry(
        Role role, ICurrentUser me, TimeProvider clock, string summary) => new()
    {
        EntityName = "RolePermissions",
        EntityId = role.Code.ToString(),
        Action = Domain.Auditing.AuditAction.Updated,
        Changes = System.Text.Json.JsonSerializer.Serialize(new { summary }),
        ChangedBy = me.Id,
        ChangedByName = me.FullName,
        ChangedAt = clock.GetUtcNow(),
    };

    /// <summary>Public so the rules can be asserted directly rather than through an HTTP call.</summary>
    public static List<PermissionWarning> WarningsFor(IReadOnlySet<string> permissions) =>
        Conflicts
            .Where(c => permissions.Contains(c.A) && permissions.Contains(c.B))
            .Select(c => new PermissionWarning(c.Title, c.Detail))
            .ToList();

    /// <summary>
    /// Refuses a save that would leave nobody able to manage users. Counted over active
    /// users rather than over roles, because a role holding the permission with nobody in
    /// it locks the door just as firmly.
    /// </summary>
    private static async Task EnsureSomebodyCanStillManageUsersAsync(
        SiteStockDbContext db, Role role, IReadOnlySet<string> wanted, CancellationToken ct)
    {
        if (wanted.Contains(Permissions.UsersManage)) return;

        var others = await db.RolePermissions.AsNoTracking()
            .Where(rp => rp.Permission == Permissions.UsersManage && rp.RoleId != role.Id)
            .Select(rp => rp.RoleId)
            .ToListAsync(ct);

        var stillCovered = others.Count > 0 && await db.UserSiteRoles.AsNoTracking()
            .AnyAsync(a => others.Contains(a.RoleId) && a.User.IsActive, ct);

        if (stillCovered) return;

        throw AppException.Conflict("last_administrator",
            $"Taking \"add a user or change their roles\" away from {role.Name} would leave " +
            "nobody able to manage users — including nobody able to undo it. Give it to " +
            "another role first.");
    }
}
