using SiteStock.Api.Common.Security;

namespace SiteStock.Api.Features.Transfers;

public record CancelTransferRequest(string? Reason);

public static class TransferEndpoints
{
    public static IEndpointRouteBuilder MapTransferEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/transfers").WithTags("Transfers");

        group.MapGet("/spare", async (Guid siteId, Guid? materialId,
                TransferService service, CancellationToken ct) =>
                Results.Ok(await service.FindSpareAsync(siteId, materialId, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("FindSpareStock")
            .WithSummary("What other sites can genuinely spare — on hand less their own warn-me level, never the full figure.");

        group.MapGet("/", async (Guid? siteId, string? status, bool? open,
                TransferService service, CancellationToken ct) =>
                Results.Ok(await service.ListAsync(siteId, status, open == true, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("ListTransfers");

        group.MapGet("/{id:guid}", async (Guid id, TransferService service, CancellationToken ct) =>
                Results.Ok(await service.GetAsync(id, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("GetTransfer");

        group.MapPost("/", async (CreateTransferRequest request,
                TransferService service, CancellationToken ct) =>
            {
                var created = await service.CreateAsync(request, ct);
                return Results.Created($"/api/transfers/{created.Id}", created);
            })
            .RequirePermission(Permissions.TransfersManage)
            .WithName("RequestTransfer")
            .WithSummary("Ask another site for material it can spare.");

        group.MapPost("/{id:guid}/decide", async (Guid id, DecideTransferRequest request,
                TransferService service, CancellationToken ct) =>
                Results.Ok(await service.DecideAsync(id, request, ct)))
            .RequirePermission(Permissions.TransfersManage)
            .WithName("DecideTransfer")
            .WithSummary("The holding site answers. It may agree to less than was asked; declining needs a reason.");

        group.MapPost("/{id:guid}/dispatch", async (Guid id, DispatchTransferRequest request,
                TransferService service, CancellationToken ct) =>
                Results.Ok(await service.DispatchAsync(id, request, ct)))
            .RequirePermission(Permissions.TransfersManage)
            .WithName("DispatchTransfer")
            .WithSummary("Stock leaves the holding site now — it physically has. Between here and receipt it is in transit and belongs to neither site.");

        group.MapPost("/{id:guid}/receive", async (Guid id, ReceiveTransferRequest request,
                TransferService service, CancellationToken ct) =>
                Results.Ok(await service.ReceiveAsync(id, request, ct)))
            .RequirePermission(Permissions.TransfersManage)
            .WithName("ReceiveTransfer")
            .WithSummary("Counted in at the far end. A gap between sent and received stays visible.");

        group.MapPost("/{id:guid}/cancel", async (Guid id, CancelTransferRequest request,
                TransferService service, CancellationToken ct) =>
                Results.Ok(await service.CancelAsync(id, request.Reason, ct)))
            .RequirePermission(Permissions.TransfersManage)
            .WithName("CancelTransfer");

        return app;
    }
}
