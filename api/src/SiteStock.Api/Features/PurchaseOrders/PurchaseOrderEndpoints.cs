using SiteStock.Api.Common.Security;

namespace SiteStock.Api.Features.PurchaseOrders;

public static class PurchaseOrderEndpoints
{
    public static IEndpointRouteBuilder MapPurchaseOrderEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/purchase-orders").WithTags("Purchase orders");

        group.MapGet("/", async ([AsParameters] PurchaseOrderQuery query,
                PurchaseOrderService service, CancellationToken ct) =>
                Results.Ok(await service.ListAsync(query, ct)))
            .RequirePermission(Permissions.PurchaseOrdersRead)
            .WithName("ListPurchaseOrders");

        group.MapGet("/{id:guid}", async (Guid id, PurchaseOrderService service, CancellationToken ct) =>
                Results.Ok(await service.GetAsync(id, ct)))
            .RequirePermission(Permissions.PurchaseOrdersRead)
            .WithName("GetPurchaseOrder");

        group.MapPut("/{id:guid}", async (Guid id, EditPurchaseOrderRequest request,
                PurchaseOrderService service, CancellationToken ct) =>
                Results.Ok(await service.EditAsync(id, request, ct)))
            .RequirePermission(Permissions.PurchaseOrdersSend)
            .WithName("EditPurchaseOrder")
            .WithSummary("Delivery date, credit terms and the note — only while the order is still unsent.");

        group.MapPut("/{id:guid}/prices", async (Guid id, RepriceOrderRequest request,
                PurchaseOrderService service, CancellationToken ct) =>
                Results.Ok(await service.RepriceAsync(id, request, ct)))
            .RequirePermission(Permissions.RequisitionsPrice)
            .WithName("RepricePurchaseOrder")
            .WithSummary("New rates on an order, with a reason. Refused once anything has been received.");

        // The gate before it leaves the building. Approving is not the same permission as
        // sending: the point is that two people are involved.
        group.MapPost("/{id:guid}/approve-send", async (Guid id, SendApprovalDecision decision,
                PurchaseOrderService service, CancellationToken ct) =>
                Results.Ok(await service.ApproveSendAsync(id, decision, approved: true, ct)))
            .RequirePermission(Permissions.PurchaseOrdersRead)
            .WithName("ApprovePurchaseOrderSend")
            .WithSummary("Lets the order go to the supplier. Only for whoever is named in the settings.");

        group.MapPost("/{id:guid}/request-changes", async (Guid id, SendApprovalDecision decision,
                PurchaseOrderService service, CancellationToken ct) =>
                Results.Ok(await service.ApproveSendAsync(id, decision, approved: false, ct)))
            .RequirePermission(Permissions.PurchaseOrdersRead)
            .WithName("RequestPurchaseOrderChanges")
            .WithSummary("Sends the order back to the buyer with a reason, before it goes out.");

        group.MapPost("/{id:guid}/send", async (Guid id, SendPurchaseOrderRequest request,
                PurchaseOrderService service, CancellationToken ct) =>
                Results.Ok(await service.SendAsync(id, request, ct)))
            .RequirePermission(Permissions.PurchaseOrdersSend)
            .WithName("SendPurchaseOrder")
            .WithSummary("Records a dispatch in the communications log. Transport is not wired up yet — see the service.");

        group.MapPost("/{id:guid}/record-sent", async (Guid id, RecordSentRequest request,
                PurchaseOrderService service, CancellationToken ct) =>
                Results.Ok(await service.RecordSentAsync(id, request, ct)))
            .RequirePermission(Permissions.PurchaseOrdersSend)
            .WithName("RecordPurchaseOrderSent")
            .WithSummary("Records that the buyer sent the order themselves — printed, phoned, or from their own mailbox. Transmits nothing.");

        group.MapGet("/{id:guid}/share-text", async (Guid id, PurchaseOrderService service, CancellationToken ct) =>
                Results.Ok(await service.ShareTextAsync(id, ct)))
            .RequirePermission(Permissions.PurchaseOrdersRead)
            .WithName("PurchaseOrderShareText")
            .WithSummary("The message to hand to WhatsApp or the phone's share sheet, composed server-side so it matches the email exactly.");

        // There is deliberately no POST /purchase-orders. An order that did not come through
        // the approval gate would defeat the control the whole workflow exists to provide.

        group.MapGet("/{id:guid}/printable", async (Guid id, PurchaseOrderService service,
                CancellationToken ct) => Results.Ok(await service.PrintableAsync(id, ct)))
            .RequirePermission(Permissions.PurchaseOrdersRead)
            .WithName("PrintablePurchaseOrder")
            .WithSummary("The order as it goes to the supplier, with letterhead and totals in words.");

        return app;
    }
}
