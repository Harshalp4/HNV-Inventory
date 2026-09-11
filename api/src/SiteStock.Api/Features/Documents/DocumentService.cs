using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Configuration;
using SiteStock.Api.Domain.Documents;
using SiteStock.Api.Domain.Contracts;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Features.Settings;
using SiteStock.Api.Infrastructure.Persistence;
using SiteStock.Api.Infrastructure.Storage;

namespace SiteStock.Api.Features.Documents;

public record UploadResult(Guid Id, string FileName, string Kind, long SizeBytes, string Provider);

public sealed class DocumentService(
    SiteStockDbContext db,
    DocumentStorageFactory storageFactory,
    SettingsService settings,
    ICurrentUser me,
    ILogger<DocumentService> logger)
{
    /// <summary>
    /// Only what a phone camera and a scanner actually produce. Anything else is either a
    /// mistake or somebody trying something, and both are better refused.
    /// </summary>
    private static readonly HashSet<string> Allowed = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf",
    };

    public async Task<UploadResult> UploadAsync(
        string ownerType, Guid ownerId, DocumentKind kind,
        IFormFile file, string? caption, double? latitude, double? longitude,
        CancellationToken ct)
    {
        if (file.Length == 0)
            throw AppException.BadRequest("empty_file", "That file is empty.");

        if (!Allowed.Contains(file.ContentType))
        {
            throw AppException.BadRequest("unsupported_type",
                "Attach a photo (JPEG, PNG, WebP or HEIC) or a PDF.");
        }

        var maxMb = await settings.GetAsync(SettingKeys.MaxUploadMegabytes, 15, ct);
        if (file.Length > maxMb * 1024L * 1024L)
        {
            throw AppException.BadRequest("file_too_large",
                $"That file is {file.Length / 1024 / 1024} MB. The limit is {maxMb} MB.");
        }

        await EnsureOwnerAccessAsync(ownerType, ownerId, ct);

        var storage = await storageFactory.CreateAsync(ct);

        await using var stream = file.OpenReadStream();
        var stored = await storage.SaveAsync(
            stream, file.FileName, file.ContentType, $"{ownerType.ToLowerInvariant()}/{ownerId:N}", ct);

        var document = new StoredFile
        {
            OwnerType = ownerType,
            OwnerId = ownerId,
            Kind = kind,
            FileName = Path.GetFileName(file.FileName),
            ContentType = file.ContentType,
            SizeBytes = stored.SizeBytes,
            StorageKey = stored.StorageKey,
            StorageProvider = stored.Provider,
            UploadedById = me.Id,
            Caption = caption?.Trim(),
            Latitude = latitude,
            Longitude = longitude,
        };

        db.Documents.Add(document);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Stored {Kind} for {OwnerType} {OwnerId} via {Provider} ({Size} bytes)",
            kind, ownerType, ownerId, stored.Provider, stored.SizeBytes);

        return new UploadResult(document.Id, document.FileName, kind.ToString(), stored.SizeBytes, stored.Provider);
    }

    /// <summary>
    /// Downloads go through the API rather than a public URL, so the site-scoping check
    /// happens on every single read. A leaked blob URL should not be a leaked rejection photo.
    /// </summary>
    public async Task<(Stream Content, string ContentType, string FileName)> OpenAsync(
        Guid id, CancellationToken ct)
    {
        var document = await db.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id, ct)
                       ?? throw AppException.NotFound("That document");

        await EnsureOwnerAccessAsync(document.OwnerType, document.OwnerId, ct);

        var storage = await storageFactory.CreateAsync(ct);
        var content = await storage.OpenAsync(document.StorageKey, ct);

        if (content is null)
        {
            throw AppException.NotFound(
                $"The file for {document.FileName} is missing from {document.StorageProvider} storage");
        }

        return (content, document.ContentType, document.FileName);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var document = await db.Documents.FirstOrDefaultAsync(d => d.Id == id, ct)
                       ?? throw AppException.NotFound("That document");

        await EnsureOwnerAccessAsync(document.OwnerType, document.OwnerId, ct);

        // A decided receipt's evidence is part of the record. Removing it after the fact
        // would let somebody quietly unpick why a delivery was refused.
        if (document.OwnerType == nameof(GoodsReceipt))
        {
            var receipt = await db.GoodsReceipts.AsNoTracking()
                .FirstOrDefaultAsync(g => g.Id == document.OwnerId, ct);

            if (receipt is not null && receipt.Status != GoodsReceiptStatus.Draft)
            {
                throw AppException.BadRequest("receipt_decided",
                    "This delivery has already been decided. Its photos are part of the record.");
            }
        }

        var storage = await storageFactory.CreateAsync(ct);
        await storage.DeleteAsync(document.StorageKey, ct);

        db.Documents.Remove(document);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Site scoping follows the thing the document is attached to.</summary>
    private async Task EnsureOwnerAccessAsync(string ownerType, Guid ownerId, CancellationToken ct)
    {
        Guid? siteId = ownerType switch
        {
            nameof(GoodsReceipt) => await db.GoodsReceipts.AsNoTracking()
                .Where(g => g.Id == ownerId).Select(g => (Guid?)g.SiteId).FirstOrDefaultAsync(ct),
            nameof(WorkOrder) => await db.WorkOrders.AsNoTracking()
                .Where(w => w.Id == ownerId).Select(w => (Guid?)w.SiteId).FirstOrDefaultAsync(ct),
            _ => null,
        };

        if (siteId is { } id && !me.CanSeeSite(id))
            throw AppException.Forbidden("That belongs to a site you do not have access to.");
    }
}
