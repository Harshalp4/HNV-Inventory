using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Configuration;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Features.Settings;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Notifications;

public record EmailSettingsDto(
    string SmtpHost, int SmtpPort, bool UseSsl, string Username,
    string FromAddress, string? FromName,
    bool HasPassword, DateTimeOffset? VerifiedAt, string? LastError,
    /// <summary>False until a test send has actually succeeded.</summary>
    bool IsUsable);

public record SaveEmailSettingsRequest(
    string SmtpHost, int SmtpPort, bool UseSsl, string Username,
    string? Password, string FromAddress, string? FromName);

public record TestEmailResult(bool Ok, string Message);

/// <summary>
/// Resolves which mailbox an outgoing message goes through, and lets a person set up their
/// own. The order is deliberate: <b>the signed-in user's account first</b>, so a supplier
/// gets an order from the buyer they already speak to, and replies land in that person's
/// inbox rather than a shared void nobody watches.
/// </summary>
public sealed class EmailAccountService(
    SiteStockDbContext db,
    SettingsService settings,
    SmtpEmailSender sender,
    IDataProtectionProvider protection,
    ICurrentUser me,
    TimeProvider clock)
{
    private readonly IDataProtector _protector = protection.CreateProtector("SiteStock.Settings.v1");

    public async Task<EmailSettingsDto> GetMineAsync(CancellationToken ct)
    {
        var setting = await db.UserEmailSettings.AsNoTracking()
            .FirstOrDefaultAsync(s => s.UserId == me.Id, ct);

        var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == me.Id, ct);

        if (setting is null)
        {
            // Pre-fill from what we already know so the form is half-done on arrival.
            return new EmailSettingsDto(
                SuggestHost(user.Email), 587, false, user.Email ?? string.Empty,
                user.Email ?? string.Empty, user.FullName,
                false, null, null, false);
        }

        return new EmailSettingsDto(
            setting.SmtpHost, setting.SmtpPort, setting.UseSsl, setting.Username,
            setting.FromAddress, setting.FromName,
            !string.IsNullOrEmpty(setting.PasswordEncrypted),
            setting.VerifiedAt, setting.LastError, setting.IsUsable);
    }

    public async Task<EmailSettingsDto> SaveMineAsync(
        SaveEmailSettingsRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.SmtpHost))
            throw AppException.BadRequest("host_required", "Which mail server should send it?");

        if (string.IsNullOrWhiteSpace(request.FromAddress))
            throw AppException.BadRequest("from_required", "Which address will suppliers see?");

        if (request.SmtpPort is < 1 or > 65535)
            throw AppException.BadRequest("bad_port", "That is not a valid port. Usually 587, sometimes 465.");

        var setting = await db.UserEmailSettings.FirstOrDefaultAsync(s => s.UserId == me.Id, ct);

        if (setting is null)
        {
            setting = new UserEmailSetting { UserId = me.Id };
            db.UserEmailSettings.Add(setting);
        }

        setting.SmtpHost = request.SmtpHost.Trim();
        setting.SmtpPort = request.SmtpPort;
        setting.UseSsl = request.UseSsl || request.SmtpPort == 465;
        setting.Username = request.Username.Trim();
        setting.FromAddress = request.FromAddress.Trim();
        setting.FromName = request.FromName?.Trim();

        // Blank means "leave it alone" — the browser never had the password to send back.
        if (!string.IsNullOrEmpty(request.Password))
            setting.PasswordEncrypted = _protector.Protect(request.Password);

        // Any change invalidates the previous proof that it works.
        setting.VerifiedAt = null;
        setting.LastError = null;

        await db.SaveChangesAsync(ct);
        return await GetMineAsync(ct);
    }

    public async Task<TestEmailResult> TestMineAsync(CancellationToken ct)
    {
        var account = await ResolveAsync(me.Id, ct);

        if (account is null)
        {
            return new TestEmailResult(false,
                "Fill in the mail server, username and password first.");
        }

        var outcome = await sender.SendAsync(account, new EmailMessage(
            account.FromAddress, account.FromName,
            "SiteStock — your email is working",
            """
            <p>This is a test from SiteStock.</p>
            <p>Your account is set up correctly. Purchase orders you send will go out from
            this address, and suppliers replying will reach your inbox.</p>
            """,
            "This is a test from SiteStock. Your account is set up correctly."), ct);

        var setting = await db.UserEmailSettings.FirstOrDefaultAsync(s => s.UserId == me.Id, ct);

        if (setting is not null)
        {
            setting.VerifiedAt = outcome.Sent ? clock.GetUtcNow() : null;
            setting.LastError = outcome.Sent ? null : outcome.Message;
            await db.SaveChangesAsync(ct);
        }

        return new TestEmailResult(outcome.Sent,
            outcome.Sent
                ? $"Sent a test to {account.FromAddress}. Check your inbox — if it is not there, look in spam."
                : outcome.Message);
    }

    /// <summary>
    /// The account to send as: this person's own if set up, otherwise the company's shared
    /// mailbox from Settings, otherwise nothing — in which case the caller records the
    /// dispatch without pretending to have sent it.
    /// </summary>
    public async Task<EmailAccount?> ResolveAsync(Guid userId, CancellationToken ct)
    {
        var personal = await db.UserEmailSettings.AsNoTracking()
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);

        if (personal is { IsUsable: true })
        {
            var password = Unprotect(personal.PasswordEncrypted!);
            if (password is not null)
            {
                return new EmailAccount(
                    personal.SmtpHost, personal.SmtpPort, personal.UseSsl,
                    personal.Username, password, personal.FromAddress, personal.FromName);
            }
        }

        return await CompanyAsync(settings, ct);
    }

    /// <summary>
    /// The company's shared mailbox from Settings, with no person attached. This is what the
    /// background scanner sends as: nobody is signed in at three in the morning, and an alert
    /// about an approval nobody has touched should not appear to come from a colleague.
    /// </summary>
    public static async Task<EmailAccount?> CompanyAsync(SettingsService settings, CancellationToken ct)
    {
        var provider = await settings.GetAsync(SettingKeys.EmailProvider, ct);
        if (!string.Equals(provider, "Smtp", StringComparison.OrdinalIgnoreCase)) return null;

        var host = await settings.GetAsync(SettingKeys.SmtpHost, ct);
        var username = await settings.GetAsync(SettingKeys.SmtpUsername, ct);
        var companyPassword = await settings.GetAsync(SettingKeys.SmtpPassword, ct);
        var from = await settings.GetAsync(SettingKeys.EmailFromAddress, ct);

        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(from)) return null;

        var port = await settings.GetAsync(SettingKeys.SmtpPort, 587, ct);

        return new EmailAccount(
            host, port, port == 465, username ?? from, companyPassword ?? string.Empty,
            from, await settings.GetAsync(SettingKeys.EmailFromName, ct));
    }

    private string? Unprotect(string cipher)
    {
        try
        {
            return _protector.Unprotect(cipher);
        }
        catch
        {
            // Data Protection keys are per machine in development, so a database restored
            // elsewhere cannot read its own secrets. The caller falls back rather than throws.
            return null;
        }
    }

    /// <summary>A sensible guess so the form is not four empty boxes.</summary>
    private static string SuggestHost(string? email) => email?.Split('@').ElementAtOrDefault(1) switch
    {
        "gmail.com" or "googlemail.com" => "smtp.gmail.com",
        "outlook.com" or "hotmail.com" or "live.com" => "smtp-mail.outlook.com",
        "yahoo.com" or "yahoo.in" => "smtp.mail.yahoo.com",
        { } domain when domain.Length > 0 => $"smtp.{domain}",
        _ => string.Empty,
    };
}
