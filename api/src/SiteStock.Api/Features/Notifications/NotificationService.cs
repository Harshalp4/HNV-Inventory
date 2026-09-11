using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Notifications;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Notifications;

public record NotificationDto(
    Guid Id, string Kind, string Urgency, string Title, string? Body, string? Link,
    Guid? SiteId, DateTimeOffset CreatedAt, bool IsUnread);

public record NotificationFeed(
    IReadOnlyList<NotificationDto> Items, int Unread,
    /// <summary>Any unread urgent one — the client uses this to pick the sound.</summary>
    bool HasUrgent);

/// <summary>
/// Raises notifications and reads them back.
///
/// <para>Recipients are worked out from <b>permissions and site membership</b>, never from a
/// hard-coded list of roles. "Whoever can approve a purchase at this site" is a question the
/// permission model already answers, and asking it here means a change to who approves does
/// not silently stop telling the right person.</para>
///
/// <para>Nothing is queued for later delivery inside a transaction that might roll back:
/// notifications are added to the same DbContext as the work that caused them, so a
/// requisition and the message about it either both exist or neither does.</para>
/// </summary>
public sealed class NotificationService(
    SiteStockDbContext db,
    ICurrentUser me,
    TimeProvider clock,
    RolePermissionStore rolePermissions,
    ILogger<NotificationService> logger)
{
    /// <summary>
    /// Everyone holding a permission who can see a given site. Organisation-wide roles
    /// match every site; a site role matches only its own.
    /// </summary>
    public async Task<List<Guid>> RecipientsAsync(
        string permission, Guid? siteId, CancellationToken ct)
    {
        var codes = Enum.GetValues<RoleCode>()
            .Where(role => rolePermissions.For(role).Contains(permission))
            .ToList();

        if (codes.Count == 0) return [];

        var candidates = await db.Users.AsNoTracking()
            .Where(u => u.IsActive && u.RoleAssignments.Any(a => codes.Contains(a.Role.Code)))
            .Select(u => new
            {
                u.Id,
                Assignments = u.RoleAssignments
                    .Where(a => codes.Contains(a.Role.Code))
                    .Select(a => new { a.SiteId, Scope = a.Role.Scope })
                    .ToList(),
            })
            .ToListAsync(ct);

        return candidates
            .Where(u => siteId is null
                        || u.Assignments.Any(a => a.Scope == RoleScope.Organisation || a.SiteId == siteId))
            .Select(u => u.Id)
            .ToList();
    }

    /// <summary>
    /// Adds notifications to the current unit of work. Call it inside whatever transaction
    /// the causing action is using — <see cref="SiteStockDbContext.SaveChangesAsync"/> is
    /// the caller's to make.
    /// </summary>
    public void Raise(
        IEnumerable<Guid> userIds, NotificationKind kind, string title,
        string? body = null, string? link = null, Guid? siteId = null,
        NotificationUrgency urgency = NotificationUrgency.Normal,
        string? dedupeKey = null, bool alsoEmail = false)
    {
        foreach (var userId in userIds.Distinct())
        {
            // Telling somebody about something they just did themselves is noise.
            if (userId == me.Id) continue;

            db.Notifications.Add(new Notification
            {
                UserId = userId,
                Kind = kind,
                Urgency = urgency,
                Title = title,
                Body = body,
                Link = link,
                SiteId = siteId,
                DedupeKey = dedupeKey,
                ShouldEmail = alsoEmail,
            });
        }
    }

    /// <summary>Convenience: everyone who can do <paramref name="permission"/> at that site.</summary>
    public async Task RaiseForPermissionAsync(
        string permission, Guid? siteId, NotificationKind kind, string title,
        string? body = null, string? link = null,
        NotificationUrgency urgency = NotificationUrgency.Normal,
        string? dedupeKey = null, bool alsoEmail = false,
        CancellationToken ct = default)
    {
        var recipients = await RecipientsAsync(permission, siteId, ct);
        Raise(recipients, kind, title, body, link, siteId, urgency, dedupeKey, alsoEmail);
    }

    // ── reading ──────────────────────────────────────────────────────────────

    public async Task<NotificationFeed> FeedAsync(int take, CancellationToken ct)
    {
        var items = await db.Notifications.AsNoTracking()
            .Where(n => n.UserId == me.Id)
            .OrderByDescending(n => n.CreatedAt)
            .Take(Math.Clamp(take, 1, 100))
            .Select(n => new NotificationDto(
                n.Id, n.Kind.ToString(), n.Urgency.ToString(), n.Title, n.Body, n.Link,
                n.SiteId, n.CreatedAt, n.ReadAt == null))
            .ToListAsync(ct);

        var unread = await db.Notifications
            .CountAsync(n => n.UserId == me.Id && n.ReadAt == null, ct);

        var hasUrgent = await db.Notifications
            .AnyAsync(n => n.UserId == me.Id && n.ReadAt == null
                           && n.Urgency == NotificationUrgency.Urgent, ct);

        return new NotificationFeed(items, unread, hasUrgent);
    }

    public async Task<int> MarkReadAsync(IReadOnlyList<Guid>? ids, CancellationToken ct)
    {
        var now = clock.GetUtcNow();

        var query = db.Notifications.Where(n => n.UserId == me.Id && n.ReadAt == null);
        if (ids is { Count: > 0 }) query = query.Where(n => ids.Contains(n.Id));

        return await query.ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, now), ct);
    }
}
