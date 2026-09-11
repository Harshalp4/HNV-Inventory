namespace SiteStock.Api.Infrastructure.Storage;

public record StoredDocument(string StorageKey, string Provider, long SizeBytes, string ContentType);

/// <summary>
/// Where photos, challans and certificates actually live.
///
/// Two implementations, chosen at runtime from the settings screen: the local filesystem
/// so a developer can work without an Azure subscription, and Azure Blob for anything real.
/// The database only ever stores the key, never the bytes — a 4 MB site photo has no
/// business being in Postgres.
/// </summary>
public interface IDocumentStorage
{
    string Provider { get; }

    Task<StoredDocument> SaveAsync(
        Stream content, string fileName, string contentType, string folder, CancellationToken ct);

    Task<Stream?> OpenAsync(string storageKey, CancellationToken ct);

    Task DeleteAsync(string storageKey, CancellationToken ct);

    /// <summary>Used by the settings screen's "check it works" button.</summary>
    Task<(bool Ok, string Message)> CheckAsync(CancellationToken ct);
}
