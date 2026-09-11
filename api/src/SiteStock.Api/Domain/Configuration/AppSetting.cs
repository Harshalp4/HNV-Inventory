using SiteStock.Api.Domain.Common;

namespace SiteStock.Api.Domain.Configuration;

public enum SettingKind
{
    Text = 1,
    Number = 2,
    Boolean = 3,
    /// <summary>Encrypted at rest and never returned to the client — only ever overwritten.</summary>
    Secret = 4,
    /// <summary>One of a fixed list, e.g. the storage provider.</summary>
    Choice = 5,

    /// <summary>
    /// One or more people, stored as their ids. Rendered as a list of names to tick, because
    /// nobody should be asked to paste a GUID into a settings screen.
    /// </summary>
    People = 6,
}

/// <summary>
/// An operator-editable setting.
///
/// Note what does <b>not</b> belong here: anything the application needs before it can
/// start, and anything that should be rotated by an operations process rather than typed
/// into a screen. In production the Azure Blob connection is better handled by a managed
/// identity with no secret at all — this screen exists because you have to be able to point
/// a fresh environment at a storage account without a redeploy, and because the messaging
/// providers genuinely are per-tenant values.
/// </summary>
public class AppSetting : AuditableEntity
{
    /// <summary>Stable machine key, e.g. <c>storage.azure.connectionString</c>.</summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>Group heading on the settings screen.</summary>
    public string Category { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;
    public string? Description { get; set; }

    public SettingKind Kind { get; set; } = SettingKind.Text;

    /// <summary>Ciphertext when <see cref="Kind"/> is Secret; plain text otherwise.</summary>
    public string? Value { get; set; }

    /// <summary>Comma-separated options for a Choice setting.</summary>
    public string? Options { get; set; }

    /// <summary>Shown greyed in the field when nothing is set.</summary>
    public string? Placeholder { get; set; }

    public int SortOrder { get; set; }

    /// <summary>
    /// When true the feature this setting drives is not finished, so the screen says so
    /// rather than letting somebody configure a thing that will not happen.
    /// </summary>
    public bool ComingSoon { get; set; }
}

public static class SettingKeys
{
    // ── storage ──────────────────────────────────────────────────────────────
    public const string StorageProvider = "storage.provider";                     // Local | AzureBlob
    public const string AzureConnectionString = "storage.azure.connectionString";
    public const string AzureContainer = "storage.azure.container";
    public const string LocalStoragePath = "storage.local.path";
    public const string MaxUploadMegabytes = "storage.maxUploadMb";

    // ── email ────────────────────────────────────────────────────────────────
    public const string EmailProvider = "email.provider";                          // None | Smtp | AzureCommunication | SendGrid
    public const string EmailFromAddress = "email.fromAddress";
    public const string EmailFromName = "email.fromName";
    public const string EmailApiKey = "email.apiKey";
    public const string SmtpHost = "email.smtp.host";
    public const string SmtpPort = "email.smtp.port";
    public const string SmtpUsername = "email.smtp.username";
    public const string SmtpPassword = "email.smtp.password";

    // ── whatsapp ─────────────────────────────────────────────────────────────
    public const string WhatsAppProvider = "whatsapp.provider";
    public const string WhatsAppBusinessId = "whatsapp.businessId";
    public const string WhatsAppApiKey = "whatsapp.apiKey";

    // ── workflow ─────────────────────────────────────────────────────────────
    public const string ApprovalSlaHours = "workflow.approvalSlaHours";
    public const string RequireCertificateOnReceipt = "workflow.requireCertificateOnReceipt";
    public const string MinRejectionPhotos = "workflow.minRejectionPhotos";
    public const string AllowOverReceipt = "workflow.allowOverReceipt";

    // ── app ──────────────────────────────────────────────────────────────────
    public const string AppBaseUrl = "app.baseUrl";

    // ── company ──────────────────────────────────────────────────────────────
    public const string CompanyName = "company.name";
    public const string CompanyGstin = "company.gstin";
    public const string CompanyAddress = "company.address";
    public const string CurrencySymbol = "company.currencySymbol";
    public const string CompanyPhone = "company.phone";
    public const string CompanyEmail = "company.email";

    // ── the gate before an order leaves the building ─────────────────────────
    /// <summary>Whether a purchase order needs approving before it can be sent.</summary>
    public const string RequireSendApproval = "purchase.requireSendApproval";

    /// <summary>Who approves it. Comma-separated user ids; empty falls back to whoever approves spend.</summary>
    public const string SendApprovers = "purchase.sendApprovers";

    /// <summary>A second address printed beside the first — sales and accounts are rarely one inbox.</summary>
    public const string CompanyEmailAlternate = "company.emailAlternate";
}
