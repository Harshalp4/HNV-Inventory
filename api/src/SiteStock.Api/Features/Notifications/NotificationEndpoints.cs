namespace SiteStock.Api.Features.Notifications;

public record MarkReadRequest(IReadOnlyList<Guid>? Ids);

public static class NotificationEndpoints
{
    public static IEndpointRouteBuilder MapNotificationEndpoints(this IEndpointRouteBuilder app)
    {
        // Under /api/me: these are the signed-in person's own, and everybody has them.
        var group = app.MapGroup("/api/me/notifications").WithTags("Me").RequireAuthorization();

        group.MapGet("/", async (int? take, NotificationService service, CancellationToken ct) =>
                Results.Ok(await service.FeedAsync(take ?? 30, ct)))
            .WithName("MyNotifications")
            .WithSummary("Newest first, with the unread count and whether any unread one is urgent.");

        group.MapPost("/read", async (MarkReadRequest request,
                NotificationService service, CancellationToken ct) =>
                Results.Ok(new { marked = await service.MarkReadAsync(request.Ids, ct) }))
            .WithName("MarkNotificationsRead")
            .WithSummary("Send no ids to mark everything read.");

        return app;
    }
}
