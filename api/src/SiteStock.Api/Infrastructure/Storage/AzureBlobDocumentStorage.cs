using Azure.Core;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace SiteStock.Api.Infrastructure.Storage;

/// <summary>
/// Azure Blob Storage, configured from the settings screen.
///
/// The container is private — nothing here is ever publicly readable, and downloads go
/// through the API so the permission check happens on every read. The next step is
/// user-delegation SAS so a phone uploads a site photo straight to Blob without the API
/// relaying four megabytes over a site connection; that is a Phase 3 optimisation and is
/// deliberately not here yet.
/// </summary>
public sealed class AzureBlobDocumentStorage(
    string connectionString, string containerName, ILogger logger) : IDocumentStorage
{
    public string Provider => "AzureBlob";

    private BlobContainerClient Container(bool failFast = false)
    {
        var options = new BlobClientOptions();

        if (failFast)
        {
            // The settings screen's check must answer in seconds. The default policy retries
            // six times, which turns "you typed the account name wrong" into a thirty-second
            // wait and a wall of identical messages.
            options.Retry.MaxRetries = 0;
            options.Retry.NetworkTimeout = TimeSpan.FromSeconds(8);
        }

        return new BlobServiceClient(connectionString, options).GetBlobContainerClient(containerName);
    }

    public async Task<StoredDocument> SaveAsync(
        Stream content, string fileName, string contentType, string folder, CancellationToken ct)
    {
        var container = Container();
        await container.CreateIfNotExistsAsync(PublicAccessType.None, cancellationToken: ct);

        var key = $"{folder.Trim('/')}/{Guid.CreateVersion7()}{Path.GetExtension(fileName)}";
        var blob = container.GetBlobClient(key);

        await blob.UploadAsync(content, new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders { ContentType = contentType },
        }, ct);

        var properties = await blob.GetPropertiesAsync(cancellationToken: ct);
        return new StoredDocument(key, Provider, properties.Value.ContentLength, contentType);
    }

    public async Task<Stream?> OpenAsync(string storageKey, CancellationToken ct)
    {
        var blob = Container().GetBlobClient(storageKey);
        if (!await blob.ExistsAsync(ct)) return null;

        var download = await blob.DownloadStreamingAsync(cancellationToken: ct);
        return download.Value.Content;
    }

    public async Task DeleteAsync(string storageKey, CancellationToken ct) =>
        await Container().GetBlobClient(storageKey).DeleteIfExistsAsync(cancellationToken: ct);

    public async Task<(bool Ok, string Message)> CheckAsync(CancellationToken ct)
    {
        try
        {
            var container = Container(failFast: true);
            await container.CreateIfNotExistsAsync(PublicAccessType.None, cancellationToken: ct);

            var probe = container.GetBlobClient($".check/{Guid.NewGuid():N}.txt");
            await probe.UploadAsync(BinaryData.FromString("ok"), overwrite: true, ct);
            await probe.DeleteIfExistsAsync(cancellationToken: ct);

            return (true, $"Connected. Container '{containerName}' is reachable and writable.");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Azure Blob check failed");
            return (false, Explain(ex));
        }
    }

    /// <summary>Azure's own messages are long and full of request ids. Say the likely cause instead.</summary>
    private static string Explain(Exception ex) => ex.Message switch
    {
        var m when m.Contains("No such host", StringComparison.OrdinalIgnoreCase)
                   || m.Contains("nodename nor servname", StringComparison.OrdinalIgnoreCase)
                   || m.Contains("Name or service not known", StringComparison.OrdinalIgnoreCase)
            => "That storage account name does not exist. Check the AccountName in the connection string for typos.",
        var m when m.Contains("Signature", StringComparison.OrdinalIgnoreCase)
                   || m.Contains("AuthenticationFailed", StringComparison.OrdinalIgnoreCase)
            => "The account key was rejected. Copy the connection string again from the Azure portal.",
        var m when m.Contains("AuthorizationFailure", StringComparison.OrdinalIgnoreCase)
            => "Authorised, but not allowed to write. Check the storage account's network rules and firewall.",
        var m when m.Contains("Timeout", StringComparison.OrdinalIgnoreCase)
            => "The storage account did not respond. Check its firewall and network rules allow this server.",
        _ => ex.Message.Split('\n')[0].Split(" Retry settings", StringSplitOptions.None)[0],
    };
}
