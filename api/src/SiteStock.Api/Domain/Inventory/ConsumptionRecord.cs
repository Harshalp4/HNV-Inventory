using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Domain.Inventory;

/// <summary>What was used on site, and where it went.</summary>
public class ConsumptionRecord : AuditableEntity
{
    public Guid SiteId { get; set; }
    public Site Site { get; set; } = null!;

    public Guid MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    public decimal Quantity { get; set; }

    public DateOnly UsedOn { get; set; }

    /// <summary>"4th slab", "east block plaster" — free text until work packages exist.</summary>
    public string? WorkArea { get; set; }

    public string? Notes { get; set; }

    public Guid RecordedById { get; set; }
    public User RecordedBy { get; set; } = null!;
}

/// <summary>
/// Per site and material: when to warn, and how much to order.
///
/// The threshold fires <b>at</b> the level, not below it, and clears itself when stock rises
/// back above — an alert that has to be dismissed by hand is an alert everybody learns to
/// ignore.
/// </summary>
public class StockSetting : AuditableEntity
{
    public Guid SiteId { get; set; }
    public Site Site { get; set; } = null!;

    public Guid MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    /// <summary>Warn me when stock on hand reaches this.</summary>
    public decimal ReorderLevel { get; set; }

    /// <summary>Suggested order size when it does.</summary>
    public decimal? ReorderQuantity { get; set; }

    public bool AlertsEnabled { get; set; } = true;
}
