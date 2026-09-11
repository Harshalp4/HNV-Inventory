using SiteStock.Api.Common.Security;

namespace SiteStock.Api.Features.Inventory;

public static class StockIssueEndpoints
{
    public static IEndpointRouteBuilder MapStockIssueEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/issues").WithTags("Stock");

        group.MapGet("/recipients", async (Guid siteId, bool? includeInactive,
                StockIssueService service, CancellationToken ct) =>
                Results.Ok(await service.ListRecipientsAsync(siteId, includeInactive == true, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("ListStockRecipients")
            .WithSummary("Everybody at a site who takes material from the store.");

        group.MapPost("/recipients", async (SaveRecipientRequest request,
                StockIssueService service, CancellationToken ct) =>
            {
                var recipient = await service.AddRecipientAsync(request, ct);
                return Results.Created($"/api/issues/recipients/{recipient.Id}", recipient);
            })
            .RequirePermission(Permissions.ConsumptionRecord)
            .WithName("AddStockRecipient");

        group.MapGet("/", async (Guid siteId, int? days, StockIssueService service, CancellationToken ct) =>
                Results.Ok(await service.ListAsync(siteId, days ?? 30, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("ListStockIssues");

        group.MapGet("/outstanding", async (Guid siteId, Guid? recipientId,
                StockIssueService service, CancellationToken ct) =>
                Results.Ok(await service.OutstandingAsync(siteId, recipientId, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("OutstandingIssues")
            .WithSummary("What has been handed out and not brought back, oldest first.");

        group.MapGet("/{id:guid}", async (Guid id, StockIssueService service, CancellationToken ct) =>
                Results.Ok(await service.DescribeAsync(id, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("GetStockIssue");

        group.MapPost("/", async (IssueStockRequest request, StockIssueService service,
                CancellationToken ct) =>
            {
                var issue = await service.IssueAsync(request, ct);
                return Results.Created($"/api/issues/{issue.Id}", issue);
            })
            .RequirePermission(Permissions.ConsumptionRecord)
            .WithName("IssueStock")
            .WithSummary("Hand material to somebody. Stock comes off immediately.");

        group.MapPost("/{id:guid}/return", async (Guid id, ReturnStockRequest request,
                StockIssueService service, CancellationToken ct) =>
                Results.Ok(await service.ReturnAsync(id, request, ct)))
            .RequirePermission(Permissions.ConsumptionRecord)
            .WithName("ReturnIssuedStock")
            .WithSummary("Record what has come back. Stock goes straight back on.");

        group.MapPost("/{id:guid}/write-off", async (Guid id, WriteOffIssueRequest request,
                StockIssueService service, CancellationToken ct) =>
                Results.Ok(await service.WriteOffAsync(id, request, ct)))
            .RequirePermission(Permissions.StockAdjust)
            .WithName("WriteOffIssuedStock")
            .WithSummary("It is not coming back — damaged, lost or taken. Needs a coded reason.");

        return app;
    }
}
