using SiteStock.Api.Common.Security;

namespace SiteStock.Api.Features.Invoices;

public static class InvoiceEndpoints
{
    public static IEndpointRouteBuilder MapInvoiceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/invoices").WithTags("Invoices");

        group.MapGet("/", async ([AsParameters] InvoiceQuery query,
                InvoiceService service, CancellationToken ct) =>
                Results.Ok(await service.ListAsync(query, ct)))
            .RequirePermission(Permissions.InvoicesMatch)
            .WithName("ListInvoices")
            .WithSummary("Unresolved differences first, then by due date. needsAttention=true gives the finance queue.");

        group.MapGet("/{id:guid}", async (Guid id, InvoiceService service, CancellationToken ct) =>
                Results.Ok(await service.GetAsync(id, ct)))
            .RequirePermission(Permissions.InvoicesMatch)
            .WithName("GetInvoice");

        group.MapPost("/", async (StartInvoiceRequest request,
                InvoiceService service, CancellationToken ct) =>
            {
                var invoice = await service.StartAsync(request.PurchaseOrderId, ct);
                return Results.Created($"/api/invoices/{invoice.Id}", invoice);
            })
            .RequirePermission(Permissions.InvoicesEnter)
            .WithName("StartInvoice")
            .WithSummary("Opens an entry form pre-filled from the order and what was accepted — nobody types a bill from a blank screen.");

        group.MapPut("/{id:guid}", async (Guid id, SaveInvoiceRequest request,
                InvoiceService service, CancellationToken ct) =>
                Results.Ok(await service.SaveAndMatchAsync(id, request, ct)))
            .RequirePermission(Permissions.InvoicesEnter)
            .WithName("SaveInvoice")
            .WithSummary("Saves and runs the three-way match in one step. Compares against the accepted quantity, not the ordered one.");

        group.MapPost("/{id:guid}/variances/{varianceId:guid}/resolve", async (
                Guid id, Guid varianceId, ResolveVarianceRequest request,
                InvoiceService service, CancellationToken ct) =>
                Results.Ok(await service.ResolveVarianceAsync(id, varianceId, request, ct)))
            .RequirePermission(Permissions.InvoicesMatch)
            .WithName("ResolveVariance")
            .WithSummary("Four ways out: accept their figure, pay ours, await a credit note, or dispute the bill. A reason is mandatory.");

        group.MapPost("/{id:guid}/payments", async (Guid id, RecordPaymentRequest request,
                InvoiceService service, CancellationToken ct) =>
                Results.Ok(await service.RecordPaymentAsync(id, request, ct)))
            .RequirePermission(Permissions.PaymentsRelease)
            .WithName("RecordSupplierPayment")
            .WithSummary("Money that actually left the account. Part payments allowed — a bill is paid when they add up.");

        group.MapPost("/{id:guid}/release", async (Guid id, ReleasePaymentRequest request,
                InvoiceService service, CancellationToken ct) =>
                Results.Ok(await service.ReleaseAsync(id, request, ct)))
            .RequirePermission(Permissions.PaymentsRelease)
            .WithName("ReleasePayment")
            .WithSummary("Refused while any difference is unexplained. That refusal is the entire point of the phase.");

        return app;
    }
}
