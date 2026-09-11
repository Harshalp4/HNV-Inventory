using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Identity;

namespace SiteStock.Api.Domain.Documents;

public enum DocumentKind
{
    RejectionPhoto = 1,
    DeliveryChallan = 2,
    TestCertificate = 3,
    MaterialPhoto = 4,
    Invoice = 5,

    /// <summary>The client's own work order — the contract this job is being built against.</summary>
    ClientWorkOrder = 6,

    /// <summary>An amendment, variation or revised scope the client sent afterwards.</summary>
    WorkOrderAmendment = 7,

    Other = 99,
}

/// <summary>
/// A file's <b>reference</b>. The bytes live in blob storage or on disk; Postgres holds the
/// key, the size, the type and who uploaded it when. A four-megabyte site photo has no
/// business being in a database row.
/// </summary>
public class StoredFile : AuditableEntity
{
    /// <summary>What it is attached to — <c>GoodsReceipt</c>, <c>Supplier</c>, and so on.</summary>
    public string OwnerType { get; set; } = string.Empty;
    public Guid OwnerId { get; set; }

    public DocumentKind Kind { get; set; }

    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }

    /// <summary>Key within the storage provider. Never a URL — the provider can change.</summary>
    public string StorageKey { get; set; } = string.Empty;

    /// <summary>Which provider wrote it, so a migration knows where to look.</summary>
    public string StorageProvider { get; set; } = string.Empty;

    public Guid UploadedById { get; set; }
    public User UploadedBy { get; set; } = null!;

    /// <summary>Captured from the phone where available — a rejection photo needs to be placeable.</summary>
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    public string? Caption { get; set; }
}
