namespace SiteStock.Api.Infrastructure.Storage;

/// <summary>
/// Files on disk, under a configurable root. The development default, so the whole
/// receiving flow can be built and tested before anybody has an Azure subscription.
/// Not suitable for production: it does not survive a redeploy and does not scale past
/// one server.
/// </summary>
public sealed class LocalDocumentStorage(string rootPath, ILogger logger) : IDocumentStorage
{
    public string Provider => "Local";

    public async Task<StoredDocument> SaveAsync(
        Stream content, string fileName, string contentType, string folder, CancellationToken ct)
    {
        var safeFolder = Sanitise(folder);
        var key = $"{safeFolder}/{Guid.CreateVersion7()}{Path.GetExtension(fileName)}";
        var fullPath = Path.Combine(rootPath, key.Replace('/', Path.DirectorySeparatorChar));

        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        await using var file = File.Create(fullPath);
        await content.CopyToAsync(file, ct);

        return new StoredDocument(key, Provider, file.Length, contentType);
    }

    public Task<Stream?> OpenAsync(string storageKey, CancellationToken ct)
    {
        var fullPath = Path.Combine(rootPath, storageKey.Replace('/', Path.DirectorySeparatorChar));

        // Refuse anything that escapes the root, however it was spelled.
        var resolved = Path.GetFullPath(fullPath);
        if (!resolved.StartsWith(Path.GetFullPath(rootPath), StringComparison.Ordinal))
        {
            logger.LogWarning("Rejected a document key that escapes the storage root: {Key}", storageKey);
            return Task.FromResult<Stream?>(null);
        }

        return Task.FromResult<Stream?>(File.Exists(resolved) ? File.OpenRead(resolved) : null);
    }

    public Task DeleteAsync(string storageKey, CancellationToken ct)
    {
        var fullPath = Path.GetFullPath(Path.Combine(rootPath, storageKey.Replace('/', Path.DirectorySeparatorChar)));
        if (fullPath.StartsWith(Path.GetFullPath(rootPath), StringComparison.Ordinal) && File.Exists(fullPath))
            File.Delete(fullPath);

        return Task.CompletedTask;
    }

    public Task<(bool Ok, string Message)> CheckAsync(CancellationToken ct)
    {
        try
        {
            Directory.CreateDirectory(rootPath);
            var probe = Path.Combine(rootPath, $".check-{Guid.NewGuid():N}");
            File.WriteAllText(probe, "ok");
            File.Delete(probe);

            return Task.FromResult((true,
                $"Files are being written to {rootPath}. Fine for development — switch to Azure Blob before go-live."));
        }
        catch (Exception ex)
        {
            return Task.FromResult((false, $"Cannot write to {rootPath}: {ex.Message}"));
        }
    }

    private static string Sanitise(string folder) =>
        string.Join('/', folder.Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => string.Concat(part.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_'))));
}
