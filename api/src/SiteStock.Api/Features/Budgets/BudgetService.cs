using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Budgeting;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Budgets;

/// <summary>
/// Setting what a site may spend.
///
/// <para>The figure was read from the first release — the owner's approval screen has always
/// said what a purchase does to the budget — but nothing could write it, so it could only
/// ever be whatever the seed put there. An allocation nobody can change is not a budget.</para>
/// </summary>
public sealed class BudgetService(SiteStockDbContext db, ICurrentUser me, TimeProvider clock)
{
    public async Task<IReadOnlyList<BudgetPeriodDto>> ListAsync(
        string? financialYear, Guid? siteId, CancellationToken ct)
    {
        var year = string.IsNullOrWhiteSpace(financialYear)
            ? BudgetReader.CurrentFinancialYear(clock.GetUtcNow())
            : financialYear.Trim();

        var sites = db.Sites.AsNoTracking().Where(s => s.IsActive);

        if (siteId is { } id)
        {
            if (!me.CanSeeSite(id)) throw AppException.Forbidden("You do not have access to that site.");
            sites = sites.Where(s => s.Id == id);
        }
        else if (!me.HasAllSites)
        {
            var permitted = me.SiteIds.ToList();
            sites = sites.Where(s => permitted.Contains(s.Id));
        }

        var siteList = await sites.OrderBy(s => s.Name).ToListAsync(ct);
        var siteIds = siteList.Select(s => s.Id).ToList();

        var periods = await db.BudgetPeriods.AsNoTracking()
            .Where(p => p.FinancialYear == year && siteIds.Contains(p.SiteId))
            .ToDictionaryAsync(p => p.SiteId, p => p, ct);

        // Who last set it. The audit columns hold an id; the name is looked up here rather
        // than modelled as a navigation, because nothing else needs the relationship.
        var setterIds = periods.Values
            .Select(p => p.UpdatedBy ?? p.CreatedBy)
            .Where(id => id is not null)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();

        var setters = await db.Users.AsNoTracking()
            .Where(u => setterIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.FullName, ct);

        var (from, to) = BudgetReader.FinancialYearBounds(year);

        // Committed means an approved order exists, not that an invoice is paid — the same
        // rule the approval screen uses, or the two figures would disagree.
        var committed = await db.PurchaseOrders.AsNoTracking()
            .Where(o => siteIds.Contains(o.SiteId)
                        && o.Status != PurchaseOrderStatus.Cancelled
                        && o.IssuedAt >= from && o.IssuedAt < to)
            .GroupBy(o => o.SiteId)
            .Select(g => new { SiteId = g.Key, Total = g.Sum(o => o.GrandTotal) })
            .ToDictionaryAsync(x => x.SiteId, x => x.Total, ct);

        return siteList.Select(site =>
        {
            periods.TryGetValue(site.Id, out var period);
            committed.TryGetValue(site.Id, out var spent);

            var allocated = period?.AmountAllocated ?? 0m;

            return new BudgetPeriodDto(
                period?.Id ?? Guid.Empty, site.Id, site.Name, year,
                allocated, spent, allocated - spent,
                allocated > 0 ? (double)Math.Round(spent / allocated * 100m, 1) : 0d,
                period?.Notes,
                Setter(period),
                period?.UpdatedAt ?? period?.CreatedAt);
        }).ToList();

        string? Setter(BudgetPeriod? period)
        {
            var id = period?.UpdatedBy ?? period?.CreatedBy;
            return id is not null && setters.TryGetValue(id.Value, out var name) ? name : null;
        }
    }

    public async Task<BudgetPeriodDto> SaveAsync(SaveBudgetRequest request, CancellationToken ct)
    {
        if (!me.CanSeeSite(request.SiteId))
            throw AppException.Forbidden("You do not have access to that site.");

        var year = (request.FinancialYear ?? string.Empty).Trim();

        // "2026-27". Anything else makes the year boundaries — and therefore every figure
        // measured against them — quietly wrong.
        if (!System.Text.RegularExpressions.Regex.IsMatch(year, @"^\d{4}-\d{2}$"))
        {
            throw AppException.BadRequest("invalid_year",
                "A financial year reads like 2026-27.");
        }

        if (request.AmountAllocated < 0)
            throw AppException.BadRequest("invalid_amount", "An allocation cannot be negative.");

        var period = await db.BudgetPeriods
            .FirstOrDefaultAsync(p => p.SiteId == request.SiteId && p.FinancialYear == year, ct);

        if (period is null)
        {
            period = new BudgetPeriod { SiteId = request.SiteId, FinancialYear = year };
            db.BudgetPeriods.Add(period);
        }

        period.AmountAllocated = request.AmountAllocated;
        period.Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim();

        await db.SaveChangesAsync(ct);

        var saved = await ListAsync(year, request.SiteId, ct);
        return saved[0];
    }
}
