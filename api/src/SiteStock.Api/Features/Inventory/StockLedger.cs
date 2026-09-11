using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Domain.Inventory;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Inventory;

public record StockOnHand(
    Guid MaterialId, string MaterialCode, string MaterialName, string? Specification,
    string Category, string UnitCode, int UnitDecimalPlaces,
    /// <summary>Expected back when handed to somebody — plates, props, tools.</summary>
    bool IsReturnable,
    decimal Quantity, decimal? ReorderLevel, decimal? ReorderQuantity,
    bool AlertsEnabled, DateTimeOffset? LastMovementAt,
    /// <summary>Average daily use over the trailing 30 days. Arithmetic, not a forecast.</summary>
    decimal AverageDailyUse,
    double? DaysOfCover)
{
    /// <summary>Fires <b>at</b> the level, not below it, and clears itself when stock rises.</summary>
    public bool BelowReorderLevel => AlertsEnabled && ReorderLevel is { } level && Quantity <= level;
}

/// <summary>
/// Reads the stock ledger.
///
/// There is no "quantity on hand" column anywhere. The balance is the sum of the movement
/// rows, every time. At a few hundred movements per material per year this is a millisecond
/// query on the right index, and it cannot drift out of step with its own history — which a
/// cached column eventually always does.
///
/// If it ever does get slow, the fix is a maintained projection rebuilt from the ledger,
/// not a mutable column. The ledger stays the truth.
/// </summary>
public sealed class StockLedger(SiteStockDbContext db, TimeProvider clock)
{
    public async Task<decimal> OnHandAsync(Guid siteId, Guid materialId, CancellationToken ct) =>
        await db.StockMovements
            .Where(m => m.SiteId == siteId && m.MaterialId == materialId)
            .SumAsync(m => (decimal?)m.Quantity, ct) ?? 0m;

    public async Task<Dictionary<Guid, decimal>> OnHandAsync(
        Guid siteId, IReadOnlyCollection<Guid> materialIds, CancellationToken ct)
    {
        if (materialIds.Count == 0) return [];

        var rows = await db.StockMovements
            .Where(m => m.SiteId == siteId && materialIds.Contains(m.MaterialId))
            .GroupBy(m => m.MaterialId)
            .Select(g => new { MaterialId = g.Key, Quantity = g.Sum(m => m.Quantity) })
            .ToListAsync(ct);

        return rows.ToDictionary(r => r.MaterialId, r => r.Quantity);
    }

    public async Task<IReadOnlyList<StockOnHand>> ListAsync(
        Guid siteId, bool onlyLowStock, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var thirtyDaysAgo = DateOnly.FromDateTime(now.UtcDateTime.AddDays(-30));

        var balances = await db.StockMovements
            .Where(m => m.SiteId == siteId)
            .GroupBy(m => m.MaterialId)
            .Select(g => new
            {
                MaterialId = g.Key,
                Quantity = g.Sum(m => m.Quantity),
                LastAt = g.Max(m => m.OccurredAt),
            })
            .ToListAsync(ct);

        // Trailing average consumption. This replaces the "predictive reordering" the source
        // documents wanted: days of cover is arithmetic anyone can check, and a forecast
        // nobody can check is a forecast nobody trusts.
        var use = await db.ConsumptionRecords
            .Where(c => c.SiteId == siteId && c.UsedOn >= thirtyDaysAgo)
            .GroupBy(c => c.MaterialId)
            .Select(g => new { MaterialId = g.Key, Total = g.Sum(c => c.Quantity) })
            .ToDictionaryAsync(x => x.MaterialId, x => x.Total, ct);

        var settings = await db.StockSettings
            .Where(s => s.SiteId == siteId)
            .ToDictionaryAsync(s => s.MaterialId, ct);

        var materialIds = balances.Select(b => b.MaterialId)
            .Union(settings.Keys)
            .ToList();

        var materials = await db.Materials
            .Include(m => m.Unit)
            .Where(m => materialIds.Contains(m.Id))
            .ToDictionaryAsync(m => m.Id, ct);

        var result = new List<StockOnHand>();

        foreach (var materialId in materialIds)
        {
            if (!materials.TryGetValue(materialId, out var material)) continue;

            var balance = balances.FirstOrDefault(b => b.MaterialId == materialId);
            settings.TryGetValue(materialId, out var setting);

            var quantity = balance?.Quantity ?? 0m;
            var daily = use.TryGetValue(materialId, out var total) ? Math.Round(total / 30m, 3) : 0m;

            result.Add(new StockOnHand(
                material.Id, material.Code, material.Name, material.Specification,
                material.Category, material.Unit.Code, material.Unit.DecimalPlaces,
                material.IsReturnable,
                quantity, setting?.ReorderLevel, setting?.ReorderQuantity,
                setting?.AlertsEnabled ?? false, balance?.LastAt,
                daily,
                daily > 0 ? (double)Math.Round(quantity / daily, 1) : null));
        }

        var ordered = result
            .OrderByDescending(r => r.BelowReorderLevel)
            .ThenBy(r => r.Category)
            .ThenBy(r => r.MaterialName)
            .ToList();

        return onlyLowStock ? ordered.Where(r => r.BelowReorderLevel).ToList() : ordered;
    }

    public async Task<IReadOnlyList<StockMovement>> HistoryAsync(
        Guid siteId, Guid materialId, int take, CancellationToken ct) =>
        await db.StockMovements
            .AsNoTracking()
            .Include(m => m.RecordedBy)
            .Where(m => m.SiteId == siteId && m.MaterialId == materialId)
            .OrderByDescending(m => m.OccurredAt).ThenByDescending(m => m.Id)
            .Take(take)
            .ToListAsync(ct);

    /// <summary>
    /// Appends to the ledger. Deliberately the only way movements are created, and it takes
    /// a signed quantity so the sign convention lives in one place.
    /// </summary>
    public StockMovement Append(
        Guid siteId, Guid materialId, MovementType type, decimal signedQuantity,
        string sourceType, Guid sourceId, string? sourceReference,
        Guid recordedById, DateTimeOffset occurredAt, string? notes = null,
        AdjustmentReason? reason = null)
    {
        var movement = new StockMovement
        {
            Reason = reason,
            SiteId = siteId,
            MaterialId = materialId,
            Type = type,
            Quantity = signedQuantity,
            SourceType = sourceType,
            SourceId = sourceId,
            SourceReference = sourceReference,
            RecordedById = recordedById,
            OccurredAt = occurredAt,
            Notes = notes,
        };

        db.StockMovements.Add(movement);
        return movement;
    }
}
