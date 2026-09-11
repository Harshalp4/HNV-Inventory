using SiteStock.Api.Domain.Common;

namespace SiteStock.Api.Domain.Catalog;

public class Supplier : AuditableEntity
{
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Gstin { get; set; }
    public string? ContactPerson { get; set; }
    public string? PhoneNumber { get; set; }
    public string? Email { get; set; }
    public string? AddressLine { get; set; }
    public string? City { get; set; }

    /// <summary>Agreed credit period. Read by the payment-due calculation in Phase 2.</summary>
    public int PaymentTermsDays { get; set; } = 30;

    public bool IsActive { get; set; } = true;
}
