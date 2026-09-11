using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Documents;
using SiteStock.Api.Features.Documents;

namespace SiteStock.Api.Features.WorkOrders;

public record AssignWorkOrderRequest(Guid? WorkOrderId);

public static class WorkOrderEndpoints
{
    public static IEndpointRouteBuilder MapWorkOrderEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/work-orders").WithTags("Work orders");

        group.MapGet("/", async (Guid? siteId, string? status, string? q,
                WorkOrderService service, CancellationToken ct) =>
                Results.Ok(await service.ListAsync(siteId, status, q, ct)))
            .RequirePermission(Permissions.WorkOrdersRead)
            .WithName("ListWorkOrders")
            .WithSummary("Each with the purchase spend committed against it.");

        // Whoever may raise a request may say which job it is for. Deliberately a separate
        // endpoint rather than a permission grant: the full list carries contract values,
        // and a supervisor is not shown what the client is paying.
        group.MapGet("/pickable", async (Guid? siteId,
                WorkOrderService service, CancellationToken ct) =>
                Results.Ok(await service.PickableAsync(siteId, ct)))
            .RequirePermission(Permissions.RequisitionsCreate)
            .WithName("ListPickableWorkOrders")
            .WithSummary("Open contracts to cost a request to. Numbers and names, no money.");

        group.MapGet("/{id:guid}", async (Guid id, WorkOrderService service, CancellationToken ct) =>
                Results.Ok(await service.GetAsync(id, ct)))
            .RequirePermission(Permissions.WorkOrdersRead)
            .WithName("GetWorkOrder")
            .WithSummary("The contract beside every purchase order raised against it.");

        group.MapPost("/", async (SaveWorkOrderRequest request,
                WorkOrderService service, CancellationToken ct) =>
            {
                var created = await service.CreateAsync(request, ct);
                return Results.Created($"/api/work-orders/{created.Id}", created);
            })
            .RequirePermission(Permissions.WorkOrdersManage)
            .WithName("CreateWorkOrder");

        group.MapPut("/{id:guid}", async (Guid id, SaveWorkOrderRequest request,
                WorkOrderService service, CancellationToken ct) =>
                Results.Ok(await service.UpdateAsync(id, request, ct)))
            .RequirePermission(Permissions.WorkOrdersManage)
            .WithName("UpdateWorkOrder");

        group.MapPost("/{id:guid}/set-status", async (Guid id, string status,
                WorkOrderService service, CancellationToken ct) =>
                Results.Ok(await service.SetStatusAsync(id, status, ct)))
            .RequirePermission(Permissions.WorkOrdersManage)
            .WithName("SetWorkOrderStatus")
            .WithSummary("Active, OnHold, Completed or Cancelled. Never deleted — the cost history has to survive.");

        // The client's own paperwork, kept against the contract it belongs to. Uploaded by
        // whoever manages work orders — the purchase head or the owner — because it arrives
        // by email to them, not to the gate.
        group.MapPost("/{id:guid}/documents", async (
                Guid id, IFormFile file, string kind, string? caption,
                DocumentService documents, CancellationToken ct) =>
            {
                if (!Enum.TryParse<DocumentKind>(kind, true, out var parsed))
                    parsed = DocumentKind.ClientWorkOrder;

                var result = await documents.UploadAsync(
                    nameof(Domain.Contracts.WorkOrder), id, parsed, file, caption, null, null, ct);

                return Results.Ok(result);
            })
            .RequirePermission(Permissions.WorkOrdersManage)
            .DisableAntiforgery()
            .WithName("UploadWorkOrderDocument")
            .WithSummary("The client's work order, or an amendment to it. Kind: ClientWorkOrder, WorkOrderAmendment, Other.");

        // Removing one goes through the work order rather than the general document route:
        // that route asks for the goods-receive permission, which the purchase head who
        // filed this paperwork has no reason to hold.
        group.MapDelete("/{id:guid}/documents/{documentId:guid}", async (
                Guid id, Guid documentId,
                WorkOrderService service, DocumentService documents, CancellationToken ct) =>
            {
                await service.EnsureDocumentBelongsAsync(id, documentId, ct);
                await documents.DeleteAsync(documentId, ct);
                return Results.NoContent();
            })
            .RequirePermission(Permissions.WorkOrdersManage)
            .WithName("DeleteWorkOrderDocument")
            .WithSummary("Removes one file from a contract. The contract itself is never deleted.");

        // The explicit ask: change which contract an order is costed against, from the order.
        app.MapPut("/api/purchase-orders/{id:guid}/work-order", async (
                Guid id, AssignWorkOrderRequest request,
                WorkOrderService service, CancellationToken ct) =>
            {
                await service.AssignOrderAsync(id, request.WorkOrderId, ct);
                return Results.NoContent();
            })
            .RequirePermission(Permissions.WorkOrdersManage)
            .WithTags("Work orders")
            .WithName("AssignPurchaseOrderToWorkOrder")
            .WithSummary("Send a null id to detach it. Refused if the work order is for a different site.");

        return app;
    }
}
