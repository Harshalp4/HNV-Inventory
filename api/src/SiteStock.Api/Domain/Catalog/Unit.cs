using SiteStock.Api.Domain.Common;

namespace SiteStock.Api.Domain.Catalog;

/// <summary>
/// Unit of measure. <see cref="DecimalPlaces"/> matters: cement is counted in whole bags,
/// steel is weighed to three decimals, and rounding one like the other loses money.
/// </summary>
public class Unit : AuditableEntity
{
    public string Code { get; set; } = string.Empty;   // BAG, MT, CUM, NOS
    public string Name { get; set; } = string.Empty;   // Bag, Metric tonne, Cubic metre, Numbers
    public int DecimalPlaces { get; set; }
    public bool IsActive { get; set; } = true;
}
