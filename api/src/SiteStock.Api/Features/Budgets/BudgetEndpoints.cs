using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;

namespace SiteStock.Api.Features.Budgets;

/// <param name="FinancialYear">Indian style, as <c>2026-27</c>.</param>
public record SaveBudgetRequest(Guid SiteId, string FinancialYear, decimal AmountAllocated, string? Notes);

/// <param name="Committed">Approved orders in that year, so an allocation can be judged.</param>
public record BudgetPeriodDto(
    Guid Id, Guid SiteId, string SiteName, string FinancialYear,
    decimal AmountAllocated, decimal Committed, decimal Remaining, double PercentUsed,
    string? Notes, string? SetByName, DateTimeOffset? SetAt);

public static class BudgetEndpoints
{
    public static IEndpointRouteBuilder MapBudgetEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/budgets").WithTags("Budgets");

        group.MapGet("/", async (string? financialYear, Guid? siteId,
                BudgetService service, CancellationToken ct) =>
                Results.Ok(await service.ListAsync(financialYear, siteId, ct)))
            .RequirePermission(Permissions.BudgetsRead)
            .WithName("ListBudgets")
            .WithSummary("What each site may spend this year, beside what it has committed.");

        group.MapPut("/", async (SaveBudgetRequest request, BudgetService service, CancellationToken ct) =>
                Results.Ok(await service.SaveAsync(request, ct)))
            .RequirePermission(Permissions.BudgetsManage)
            .WithName("SaveBudget")
            .WithSummary("Sets what a site may spend in a financial year. Replaces the figure if one exists.");

        return app;
    }
}
