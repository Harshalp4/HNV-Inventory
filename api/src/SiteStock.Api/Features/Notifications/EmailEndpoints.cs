using SiteStock.Api.Common.Security;

namespace SiteStock.Api.Features.Notifications;

public static class EmailEndpoints
{
    public static IEndpointRouteBuilder MapEmailEndpoints(this IEndpointRouteBuilder app)
    {
        // Under /api/me because this is the signed-in person's own mailbox, not an
        // administrative setting. Anybody who can send an order can set one up.
        var group = app.MapGroup("/api/me/email").WithTags("Me").RequireAuthorization();

        group.MapGet("/", async (EmailAccountService service, CancellationToken ct) =>
                Results.Ok(await service.GetMineAsync(ct)))
            .WithName("GetMyEmailSettings")
            .WithSummary("Pre-filled from the account's email domain when nothing is saved yet.");

        group.MapPut("/", async (SaveEmailSettingsRequest request,
                EmailAccountService service, CancellationToken ct) =>
                Results.Ok(await service.SaveMineAsync(request, ct)))
            .WithName("SaveMyEmailSettings")
            .WithSummary("Send an empty password to leave the stored one alone. Saving clears the previous verification.");

        group.MapPost("/test", async (EmailAccountService service, CancellationToken ct) =>
                Results.Ok(await service.TestMineAsync(ct)))
            .WithName("TestMyEmailSettings")
            .WithSummary("Sends a test to your own address. Nothing is marked verified until this succeeds.");

        return app;
    }
}
