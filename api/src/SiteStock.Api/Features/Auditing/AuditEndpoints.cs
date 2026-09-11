using SiteStock.Api.Common.Security;

namespace SiteStock.Api.Features.Auditing;

public static class AuditEndpoints
{
    public static IEndpointRouteBuilder MapAuditEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/audit").WithTags("Audit")
            .RequirePermission(Permissions.AuditRead);

        group.MapGet("/", async ([AsParameters] AuditQuery query,
                AuditService service, CancellationToken ct) =>
                Results.Ok(await service.ListAsync(query, ct)))
            .WithName("AuditTrail")
            .WithSummary("Who changed what, newest first. Filter by record, person or date.");

        group.MapGet("/record-types", async (AuditService service, CancellationToken ct) =>
                Results.Ok(await service.RecordTypesAsync(ct)))
            .WithName("AuditRecordTypes")
            .WithSummary("The kinds of record that actually appear in the log.");

        return app;
    }
}
