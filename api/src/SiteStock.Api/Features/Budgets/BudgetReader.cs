using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Features.Requisitions;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Budgets;

/// <summary>
/// The budget position for a site, and the rule that enforces it.
///
/// <para>An <b>alert at 80%</b> so the owner sees it coming, and a <b>hard block at 100%</b>
/// that only the owner can pass, with a typed reason recorded against their name. The
/// override is a row in <c>budget_overrides</c> rather than a flag, because the useful
/// questions are how often it happens and on whose authority — and a boolean answers
/// neither.</para>
///
/// <para>Committed means "an approved order exists", not "an invoice has been paid": money
/// is committed the moment the owner approves, which is the point at which the company can
/// no longer walk away without a conversation.</para>
/// </summary>
public sealed class BudgetReader(SiteStockDbContext db, TimeProvider clock)
{
    public async Task<BudgetSnapshot> SnapshotAsync(
        Guid siteId, decimal thisRequisition, CancellationToken ct)
    {
        var year = CurrentFinancialYear(clock.GetUtcNow());

        var period = await db.BudgetPeriods
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.SiteId == siteId && p.FinancialYear == year, ct);

        var (from, to) = FinancialYearBounds(year);

        // Committed means "an approved order exists", not "an invoice has been paid".
        // Money is committed the moment the owner approves, which is the point at which
        // the company can no longer walk away without a conversation.
        var committed = await db.PurchaseOrders
            .AsNoTracking()
            .Where(o => o.SiteId == siteId
                        && o.Status != PurchaseOrderStatus.Cancelled
                        && o.IssuedAt >= from && o.IssuedAt < to)
            .SumAsync(o => (decimal?)o.GrandTotal, ct) ?? 0m;

        var allocated = period?.AmountAllocated ?? 0m;
        var remaining = allocated - committed - thisRequisition;

        var percentAfter = allocated > 0
            ? (double)Math.Round((committed + thisRequisition) / allocated * 100m, 1)
            : 0d;

        var state = period is null
            ? BudgetState.NotSet
            : percentAfter >= 100
                ? BudgetState.OverBudget
                : percentAfter >= WarningPercent
                    ? BudgetState.NearLimit
                    : BudgetState.WithinBudget;

        return new BudgetSnapshot(
            year, allocated, committed, thisRequisition, remaining, percentAfter,
            HasBudget: period is not null,
            State: state.ToString(),
            RequiresOverride: state == BudgetState.OverBudget,
            Message: Describe(state, percentAfter, remaining));
    }

    /// <summary>The level at which the owner is warned but not stopped.</summary>
    public const double WarningPercent = 80d;

    private enum BudgetState { NotSet, WithinBudget, NearLimit, OverBudget }

    private static string? Describe(BudgetState state, double percent, decimal remaining) => state switch
    {
        BudgetState.NotSet =>
            "No budget has been set for this site and year, so there is nothing to check this against.",

        BudgetState.NearLimit =>
            $"This takes the site to {percent:0.#}% of the year's budget. " +
            $"{Money(remaining)} would be left. Worth knowing before the next big order.",

        BudgetState.OverBudget =>
            $"This would take the site to {percent:0.#}% — {Money(Math.Abs(remaining))} beyond the " +
            "budget. Approving it needs an override, and the reason is recorded against your name.",

        _ => null,
    };

    private static string Money(decimal value) => $"₹{value:N0}";

    /// <summary>
    /// Records an owner going past the limit. Called inside the approval transaction, so an
    /// override and the approval it permitted can never exist separately.
    /// </summary>
    public void RecordOverride(
        Guid siteId, string financialYear, Guid requisitionId,
        decimal amountOver, string reason, Guid ownerId)
    {
        db.BudgetOverrides.Add(new Domain.Billing.BudgetOverride
        {
            SiteId = siteId,
            FinancialYear = financialYear,
            RequisitionId = requisitionId,
            AmountOverBudget = amountOver,
            Reason = reason.Trim(),
            ApprovedById = ownerId,
        });
    }

    /// <summary>Indian financial year: 1 April to 31 March, written as <c>2026-27</c>.</summary>
    public static string CurrentFinancialYear(DateTimeOffset now)
    {
        var date = now.UtcDateTime;
        var startYear = date.Month >= 4 ? date.Year : date.Year - 1;
        return $"{startYear}-{(startYear + 1) % 100:00}";
    }

    public static (DateTimeOffset From, DateTimeOffset To) FinancialYearBounds(string financialYear)
    {
        var startYear = int.Parse(financialYear[..4]);
        return (
            new DateTimeOffset(startYear, 4, 1, 0, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(startYear + 1, 4, 1, 0, 0, 0, TimeSpan.Zero));
    }
}
