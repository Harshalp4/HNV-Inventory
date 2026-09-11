using SiteStock.Api.Domain.Configuration;
using SiteStock.Api.Features.Settings;

namespace SiteStock.Api.Infrastructure.Storage;

/// <summary>
/// Builds the storage provider the settings currently say to use.
///
/// Resolved per request rather than registered once at startup, because an administrator
/// pointing the system at a storage account should not have to restart it. If Azure is
/// selected but not configured, we fall back to local and log loudly rather than failing
/// a supervisor's goods receipt at a site gate — losing the photo is worse than storing
/// it in the wrong place.
/// </summary>
public sealed class DocumentStorageFactory(
    SettingsService settings,
    IWebHostEnvironment environment,
    IConfiguration configuration,
    ILoggerFactory loggerFactory)
{
    public async Task<IDocumentStorage> CreateAsync(CancellationToken ct = default)
    {
        var provider = await settings.GetAsync(SettingKeys.StorageProvider, ct) ?? "Local";

        if (provider.Equals("AzureBlob", StringComparison.OrdinalIgnoreCase))
        {
            var connection = await settings.GetAsync(SettingKeys.AzureConnectionString, ct);
            var container = await settings.GetAsync(SettingKeys.AzureContainer, ct) ?? "sitestock-documents";

            if (!string.IsNullOrWhiteSpace(connection))
            {
                return new AzureBlobDocumentStorage(
                    connection, container, loggerFactory.CreateLogger<AzureBlobDocumentStorage>());
            }

            loggerFactory.CreateLogger<DocumentStorageFactory>().LogWarning(
                "Storage provider is set to AzureBlob but no connection string is configured. " +
                "Falling back to local files so uploads keep working — fix this on the settings screen.");
        }

        var root = await settings.GetAsync(SettingKeys.LocalStoragePath, ct);

        /*
         * Where files land when nobody has set a path on the settings screen.
         *
         * The host gets a say before the built-in default does. On a container platform the
         * only durable place is a mounted volume, and the content root is wiped on every
         * deploy — so a default of ContentRootPath/App_Data means uploads appear to work,
         * succeed, and are gone by the next release. Storage:LocalPath lets the deployment
         * point this at the mount without anyone having to remember a settings screen on
         * the day the system goes live.
         */
        if (string.IsNullOrWhiteSpace(root))
            root = configuration["Storage:LocalPath"];

        if (string.IsNullOrWhiteSpace(root))
            root = Path.Combine(environment.ContentRootPath, "App_Data", "documents");

        return new LocalDocumentStorage(root, loggerFactory.CreateLogger<LocalDocumentStorage>());
    }
}
