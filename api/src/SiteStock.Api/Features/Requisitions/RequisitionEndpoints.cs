using FluentValidation;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;

namespace SiteStock.Api.Features.Requisitions;

public static class RequisitionEndpoints
{
    public static IEndpointRouteBuilder MapRequisitionEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/requisitions").WithTags("Requisitions");

        group.MapGet("/", async ([AsParameters] RequisitionQuery query,
                RequisitionService service, CancellationToken ct) =>
                Results.Ok(await service.ListAsync(query, ct)))
            .RequirePermission(Permissions.RequisitionsRead)
            .WithName("ListRequisitions")
            .WithSummary("Urgent first, then by required-by date. mineToAction=true gives the caller's own queue.");

        group.MapGet("/counts", async (Guid? siteId, RequisitionService service, CancellationToken ct) =>
                Results.Ok(await service.CountsAsync(siteId, ct)))
            .RequirePermission(Permissions.RequisitionsRead)
            .WithName("RequisitionCounts")
            .WithSummary("How many sit in each state, for the filter chips.");

        group.MapGet("/{id:guid}", async (Guid id, RequisitionService service, CancellationToken ct) =>
                Results.Ok(await service.GetAsync(id, ct)))
            .RequirePermission(Permissions.RequisitionsRead)
            .WithName("GetRequisition");

        group.MapPost("/", async (SaveRequisitionRequest request, RequisitionService service,
                IValidator<SaveRequisitionRequest> validator, CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);
                var created = await service.CreateAsync(request, ct);
                return Results.Created($"/api/requisitions/{created.Id}", created);
            })
            .RequirePermission(Permissions.RequisitionsCreate)
            .WithName("CreateRequisition")
            .WithSummary("Creates a draft. Nobody else sees it until it is submitted.");

        group.MapPut("/{id:guid}", async (Guid id, SaveRequisitionRequest request,
                RequisitionService service, IValidator<SaveRequisitionRequest> validator,
                CancellationToken ct) =>
            {
                await validator.ValidateOrThrowAsync(request, ct);
                return Results.Ok(await service.UpdateAsync(id, request, ct));
            })
            .RequirePermission(Permissions.RequisitionsCreate)
            .WithName("UpdateRequisition")
            .WithSummary("Drafts only, and only by the person who raised it.");

        group.MapPost("/{id:guid}/amend", async (
                Guid id, AmendRequisitionRequest request, RequisitionAmendmentService amendments,
                RequisitionService requisitions, CancellationToken ct) =>
            {
                var amended = await amendments.AmendAsync(id, request, ct);
                return Results.Ok(await requisitions.GetAsync(amended.Id, ct));
            })
            .RequirePermission(Permissions.RequisitionsCreate)
            .WithName("AmendRequisition")
            .WithSummary("Change a requisition the site has already sent on. Every change is recorded.");

        group.MapPost("/{id:guid}/submit", async (Guid id, RequisitionService service, CancellationToken ct) =>
                Results.Ok(await service.TransitionAsync(id, RequisitionAction.Submit, null, ct)))
            .RequirePermission(Permissions.RequisitionsCreate)
            .WithName("SubmitRequisition");

        group.MapPost("/{id:guid}/cancel", async (Guid id, TransitionRequest body,
                RequisitionService service, CancellationToken ct) =>
                Results.Ok(await service.TransitionAsync(id, RequisitionAction.Cancel, body.Reason, ct)))
            .RequirePermission(Permissions.RequisitionsCreate)
            .WithName("CancelRequisition");

        // ── purchase head ────────────────────────────────────────────────────

        group.MapPost("/{id:guid}/work-order", async (Guid id, SetWorkOrderRequest body,
                RequisitionService service, CancellationToken ct) =>
                Results.Ok(await service.SetWorkOrderAsync(id, body.WorkOrderId, ct)))
            .RequirePermission(Permissions.RequisitionsPrice)
            .WithName("SetRequisitionWorkOrder")
            .WithSummary("Cost this request to a client contract, or clear it.");

        group.MapPost("/{id:guid}/price", async (Guid id, PriceRequisitionRequest request,
                RequisitionService service, CancellationToken ct) =>
                Results.Ok(await service.PriceAsync(id, request, ct)))
            .RequirePermission(Permissions.RequisitionsPrice)
            .WithName("PriceRequisition")
            .WithSummary("Award every line to a supplier at a rate. Partial pricing is refused.");

        group.MapPost("/{id:guid}/send-back", async (Guid id, TransitionRequest body,
                RequisitionService service, CancellationToken ct) =>
                Results.Ok(await service.TransitionAsync(id, RequisitionAction.SendBackToDraft, body.Reason, ct)))
            .RequirePermission(Permissions.RequisitionsPrice)
            .WithName("SendRequisitionBack")
            .WithSummary("Return an unclear requisition to the supervisor. A reason is required.");

        // ── owner ────────────────────────────────────────────────────────────

        group.MapPost("/{id:guid}/approve", async (Guid id, TransitionRequest body,
                RequisitionService service, CancellationToken ct) =>
                Results.Ok(await service.TransitionAsync(id, RequisitionAction.Approve, body.Reason, ct)))
            .RequirePermission(Permissions.PurchasesApprove)
            .WithName("ApproveRequisition")
            .WithSummary("The approval gate. Generates one purchase order per awarded supplier, in the same transaction.");

        group.MapPost("/{id:guid}/reject", async (Guid id, TransitionRequest body,
                RequisitionService service, CancellationToken ct) =>
                Results.Ok(await service.TransitionAsync(id, RequisitionAction.Reject, body.Reason, ct)))
            .RequirePermission(Permissions.PurchasesApprove)
            .WithName("RejectRequisition")
            .WithSummary("A reason is mandatory — a decision nobody can explain later is not a decision.");

        group.MapPost("/{id:guid}/reprice", async (Guid id, TransitionRequest body,
                RequisitionService service, CancellationToken ct) =>
                Results.Ok(await service.TransitionAsync(id, RequisitionAction.SendBackForRepricing, body.Reason, ct)))
            .RequirePermission(Permissions.PurchasesApprove)
            .WithName("SendRequisitionForRepricing")
            .WithSummary("Back to the purchase head — too expensive, wrong supplier, get another quote.");

        return app;
    }
}

public class SaveRequisitionValidator : AbstractValidator<SaveRequisitionRequest>
{
    public SaveRequisitionValidator()
    {
        RuleFor(x => x.SiteId).NotEmpty().WithMessage("Choose the site this is for.");
        RuleFor(x => x.RequiredBy).NotEmpty().WithMessage("When is it needed on site?");
        RuleFor(x => x.Notes).MaximumLength(1000);
        RuleFor(x => x.Lines).NotEmpty().WithMessage("Add at least one material.");

        RuleForEach(x => x.Lines).ChildRules(line =>
        {
            line.RuleFor(l => l.MaterialId).NotEmpty().WithMessage("Choose a material.");
            line.RuleFor(l => l.Quantity).GreaterThan(0).WithMessage("How much is needed?");
            line.RuleFor(l => l.Notes).MaximumLength(500);
        });
    }
}
