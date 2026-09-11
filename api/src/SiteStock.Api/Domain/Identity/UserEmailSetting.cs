using SiteStock.Api.Domain.Common;

namespace SiteStock.Api.Domain.Identity;

/// <summary>
/// One person's own outgoing mail account, so a purchase order arrives from a human the
/// supplier already knows rather than from a no-reply address they will ignore.
///
/// <para>
/// The password is encrypted at rest with the same Data Protection key as the storage
/// secret and is never returned to the browser. It is still a credential to somebody's
/// mailbox, which is why the screen says plainly what it is for and recommends a shared
/// purchase mailbox over anybody's personal account.
/// </para>
/// <para>
/// Note that Gmail and Outlook stopped accepting an account password over SMTP: they need
/// an <b>app password</b> generated in the account's security settings, which can be revoked
/// on its own without changing the real password. That is the value that belongs here.
/// </para>
/// </summary>
public class UserEmailSetting : AuditableEntity
{
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    public string SmtpHost { get; set; } = string.Empty;
    public int SmtpPort { get; set; } = 587;

    /// <summary>STARTTLS on 587, implicit TLS on 465. Plain text is never offered.</summary>
    public bool UseSsl { get; set; }

    public string Username { get; set; } = string.Empty;

    /// <summary>Ciphertext. An app password, not the account password.</summary>
    public string? PasswordEncrypted { get; set; }

    /// <summary>The address suppliers see and reply to.</summary>
    public string FromAddress { get; set; } = string.Empty;
    public string? FromName { get; set; }

    /// <summary>Set by a successful test send. Cleared whenever the settings change.</summary>
    public DateTimeOffset? VerifiedAt { get; set; }

    public string? LastError { get; set; }

    public bool IsUsable => !string.IsNullOrWhiteSpace(SmtpHost)
                            && !string.IsNullOrWhiteSpace(Username)
                            && !string.IsNullOrWhiteSpace(PasswordEncrypted)
                            && !string.IsNullOrWhiteSpace(FromAddress);
}
