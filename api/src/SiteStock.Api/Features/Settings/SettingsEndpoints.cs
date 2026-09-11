using SiteStock.Api.Common.Security;
using SiteStock.Api.Infrastructure.Storage;

namespace SiteStock.Api.Features.Settings;

public static class SettingsEndpoints
{
    public static IEndpointRouteBuilder MapSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/settings").WithTags("Settings");

        group.MapGet("/", async (SettingsService service, CancellationToken ct) =>
                Results.Ok(await service.ListAsync(ct)))
            .RequirePermission(Permissions.SettingsManage)
            .WithName("ListSettings")
            .WithSummary("Grouped by category. Secrets report only whether a value is set, never the value.");

        group.MapPut("/", async (SaveSettingsRequest request, SettingsService service, CancellationToken ct) =>
                Results.Ok(await service.SaveAsync(request, ct)))
            .RequirePermission(Permissions.SettingsManage)
            .WithName("SaveSettings")
            .WithSummary("Send an empty string for a secret to leave it unchanged, or __clear__ to erase it.");

        group.MapPost("/check-storage", async (
                DocumentStorageFactory factory, CancellationToken ct) =>
            {
                var storage = await factory.CreateAsync(ct);
                var (ok, message) = await storage.CheckAsync(ct);
                return Results.Ok(new StorageCheckResult(ok, storage.Provider, message));
            })
            .RequirePermission(Permissions.SettingsManage)
            .WithName("CheckStorage")
            .WithSummary("Writes and deletes a probe file, so a wrong connection string is found here rather than at a site gate.");

        return app;
    }
}
