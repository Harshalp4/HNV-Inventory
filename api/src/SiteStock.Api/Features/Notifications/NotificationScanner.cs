using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Domain.Configuration;
using SiteStock.Api.Domain.Notifications;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Features.Settings;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Notifications;

/// <summary>
/// Watches for the things that are true rather than the things that happen.
///
/// <para>Most notifications are raised inline by the action that caused them — a requisition
/// is submitted, so the purchase head is told. But two matter that nobody ever <i>does</i>:
/// stock falling to its warn-me level, and an approval sitting untouched. Nothing fires an
/// event for those, so something has to look.</para>
///
/// <para>It runs in this process rather than as a separate service, and reads from Postgres
/// rather than a queue. At three sites that is the right amount of machinery: a second thing
/// to deploy and monitor buys nothing until the volume justifies it.</para>
/// </summary>
public sealed class NotificationScanner(
    IServiceScopeFactory scopes,
    TimeProvider clock,
    ILogger<NotificationScanner> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

    /// <summary>How long something gets to be read in the app before it is also emailed.</summary>
    private static readonly TimeSpan GraceBeforeEmail = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // A moment for the database to migrate and the app to settle before the first pass.
        await Task.Delay(TimeSpan.FromSeconds(20), ct);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<SiteStockDbContext>();
                var notifications = scope.ServiceProvider.GetRequiredService<NotificationService>();
                var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();

                await ScanLowStockAsync(db, notifications, ct);
                await ScanOverdueApprovalsAsync(db, notifications, settings, ct);
                await SweepOldAsync(db, ct);

                await db.SaveChangesAsync(ct);

                // After the save, so anything raised in this pass is a candidate.
                var sender = scope.ServiceProvider.GetRequiredService<SmtpEmailSender>();
                await SendPendingEmailsAsync(db, settings, sender, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // Never let one bad pass stop the loop — the next one is five minutes away
                // and the condition it is watching has not gone anywhere.
                logger.LogError(ex, "Notification scan failed; will try again");
            }

            try
            {
                await Task.Delay(Interval, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>
    /// Stock at or below its warn-me level. The dedupe key carries the site and material,
    /// so a supervisor is told once and told again only after it has been cleared and has
    /// fallen back — which is what "the alert clears itself" means in practice.
    /// </summary>
    private static async Task ScanLowStockAsync(
        SiteStockDbContext db, NotificationService notifications, CancellationToken ct)
    {
        var settings = await db.StockSettings.AsNoTracking()
            .Where(s => s.AlertsEnabled)
            .Select(s => new
            {
                s.SiteId, s.MaterialId, s.ReorderLevel,
                Material = s.Material.Name,
                Unit = s.Material.Unit.Code,
                Site = s.Site.Name,
            })
            .ToListAsync(ct);

        if (settings.Count == 0) return;

        var balances = await db.StockMovements.AsNoTracking()
            .GroupBy(m => new { m.SiteId, m.MaterialId })
            .Select(g => new { g.Key.SiteId, g.Key.MaterialId, Quantity = g.Sum(m => m.Quantity) })
            .ToListAsync(ct);

        foreach (var setting in settings)
        {
            var onHand = balances
                .FirstOrDefault(b => b.SiteId == setting.SiteId && b.MaterialId == setting.MaterialId)
                ?.Quantity ?? 0m;

            // Fires *at* the level, not below it.
            if (onHand > setting.ReorderLevel) continue;

            var key = $"low-stock:{setting.SiteId}:{setting.MaterialId}";

            // Anyone already holding an unread one is not told again.
            var alreadyTold = await db.Notifications.AsNoTracking()
                .Where(n => n.DedupeKey == key && n.ReadAt == null)
                .Select(n => n.UserId)
                .ToListAsync(ct);

            var recipients = (await notifications.RecipientsAsync(
                    Permissions.RequisitionsCreate, setting.SiteId, ct))
                .Except(alreadyTold)
                .ToList();

            if (recipients.Count == 0) continue;

            notifications.Raise(
                recipients, NotificationKind.StockLow,
                $"{setting.Material} is low at {setting.Site}",
                $"{Trim(onHand)} {setting.Unit} left — the warn-me level is {Trim(setting.ReorderLevel)}. " +
                "Check whether another site can spare some before ordering.",
                "/stock", setting.SiteId,
                onHand <= 0 ? NotificationUrgency.Urgent : NotificationUrgency.Normal,
                key);
        }
    }

    /// <summary>
    /// Requisitions waiting longer than the agreed time. The one that stops work is the one
    /// sitting in a queue nobody has looked at.
    /// </summary>
    private static async Task ScanOverdueApprovalsAsync(
        SiteStockDbContext db, NotificationService notifications,
        SettingsService settings, CancellationToken ct)
    {
        var hours = await settings.GetAsync(SettingKeys.ApprovalSlaHours, 24, ct);
        var cutoff = DateTimeOffset.UtcNow.AddHours(-Math.Max(1, hours));

        var waiting = await db.Requisitions.AsNoTracking()
            .Where(r => r.Status == RequisitionStatus.Priced
                        && r.PricedAt != null && r.PricedAt < cutoff)
            .Select(r => new
            {
                r.Id, r.Number, r.SiteId, r.Priority, r.PricedAt,
                Site = r.Site.Name,
                Total = r.Lines.Sum(l => l.Quantity * (l.UnitRate ?? 0m)),
            })
            .ToListAsync(ct);

        foreach (var requisition in waiting)
        {
            var key = $"approval-overdue:{requisition.Id}";

            var alreadyTold = await db.Notifications.AsNoTracking()
                .Where(n => n.DedupeKey == key && n.ReadAt == null)
                .Select(n => n.UserId)
                .ToListAsync(ct);

            var recipients = (await notifications.RecipientsAsync(
                    Permissions.PurchasesApprove, requisition.SiteId, ct))
                .Except(alreadyTold)
                .ToList();

            if (recipients.Count == 0) continue;

            var waited = (int)(DateTimeOffset.UtcNow - requisition.PricedAt!.Value).TotalHours;

            notifications.Raise(
                recipients, NotificationKind.ApprovalOverdue,
                $"{requisition.Number} has been waiting {waited} hours",
                $"{requisition.Site} · about ₹{requisition.Total:N0}. Nothing has been ordered yet.",
                $"/requisitions/{requisition.Id}", requisition.SiteId,
                requisition.Priority == RequisitionPriority.Urgent
                    ? NotificationUrgency.Urgent
                    : NotificationUrgency.Normal,
                key, alsoEmail: true);
        }
    }

    /// <summary>Read notifications older than a month, and the idempotency keys past their retention.</summary>
    private async Task SweepOldAsync(SiteStockDbContext db, CancellationToken ct)
    {
        var monthAgo = clock.GetUtcNow().AddDays(-30);

        var removed = await db.Notifications
            .Where(n => n.ReadAt != null && n.ReadAt < monthAgo)
            .ExecuteDeleteAsync(ct);

        var keyCutoff = clock.GetUtcNow() - Common.Idempotency.IdempotencyMiddleware.Retention;

        var keys = await db.ProcessedRequests
            .Where(r => r.CreatedAt < keyCutoff)
            .ExecuteDeleteAsync(ct);

        if (removed + keys > 0)
            logger.LogInformation("Swept {Notifications} read notifications and {Keys} old keys", removed, keys);
    }

    /// <summary>
    /// Emails the few notifications marked urgent enough to chase someone off the app.
    ///
    /// <para>Only if it is <i>still</i> unread after the grace period: someone who was in the
    /// app and dealt with it should not get a mail about it afterwards. That single condition
    /// is what keeps this from becoming the thing everyone filters into a folder.</para>
    ///
    /// <para>If no mailbox is configured the rows are simply left alone. They are not marked
    /// sent, so they will go out the day someone fills in the Settings screen — but nothing
    /// pretends to have been delivered in the meantime.</para>
    /// </summary>
    private async Task SendPendingEmailsAsync(
        SiteStockDbContext db, SettingsService settings, SmtpEmailSender sender, CancellationToken ct)
    {
        var cutoff = clock.GetUtcNow() - GraceBeforeEmail;

        var due = await db.Notifications
            .Where(n => n.ShouldEmail && n.EmailedAt == null && n.ReadAt == null && n.CreatedAt <= cutoff)
            .OrderBy(n => n.CreatedAt)
            .Take(50)
            .Select(n => new
            {
                n.Id, n.Title, n.Body, n.Link, n.Urgency,
                Name = n.User.FullName,
                Address = n.User.Email,
            })
            .ToListAsync(ct);

        var wanted = due.Where(n => !string.IsNullOrWhiteSpace(n.Address)).ToList();
        if (wanted.Count == 0) return;

        var account = await EmailAccountService.CompanyAsync(settings, ct);
        if (account is null)
        {
            logger.LogInformation(
                "{Count} notification(s) are waiting to be emailed, but no company mailbox is set up",
                wanted.Count);
            return;
        }

        var baseUrl = (await settings.GetAsync(SettingKeys.AppBaseUrl, ct))?.TrimEnd('/');
        var sent = new List<Guid>();

        foreach (var item in wanted)
        {
            if (ct.IsCancellationRequested) break;

            var url = baseUrl is null || item.Link is null ? null : baseUrl + item.Link;
            var prefix = item.Urgency == NotificationUrgency.Urgent ? "Urgent: " : string.Empty;

            var outcome = await sender.SendAsync(
                account,
                new EmailMessage(item.Address!, item.Name, prefix + item.Title, Html(item.Title, item.Body, url), Plain(item.Title, item.Body, url)),
                ct);

            if (outcome.Sent) sent.Add(item.Id);
            else logger.LogWarning("Could not email {Title} to {Address}: {Why}", item.Title, item.Address, outcome.Message);
        }

        if (sent.Count == 0) return;

        var now = clock.GetUtcNow();
        await db.Notifications
            .Where(n => sent.Contains(n.Id))
            .ExecuteUpdateAsync(u => u.SetProperty(n => n.EmailedAt, now), ct);

        logger.LogInformation("Emailed {Count} notification(s)", sent.Count);
    }

    private static string Html(string title, string? body, string? url)
    {
        var button = url is null
            ? string.Empty
            : $"""<p style="margin:24px 0 0"><a href="{url}" style="background:#2F5D7C;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Open it in SiteStock</a></p>""";

        return $"""
            <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#26343C;font-size:15px;line-height:1.55">
              <p style="font-size:17px;font-weight:700;margin:0">{System.Net.WebUtility.HtmlEncode(title)}</p>
              <p style="margin:8px 0 0;color:#5A6B75">{System.Net.WebUtility.HtmlEncode(body ?? string.Empty)}</p>
              {button}
              <p style="margin:28px 0 0;font-size:12px;color:#8A98A1">
                Sent because this was still unread in SiteStock. Opening it stops the reminder.
              </p>
            </div>
            """;
    }

    private static string Plain(string title, string? body, string? url) =>
        string.Join("\n\n", new[] { title, body, url, "Sent because this was still unread in SiteStock." }
            .Where(line => !string.IsNullOrWhiteSpace(line)));

    private static string Trim(decimal value) => value.ToString("0.###");
}
