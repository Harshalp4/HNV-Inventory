using SiteStock.Api.Domain.Common;

namespace SiteStock.Api.Domain.Organisation;

/// <summary>A construction site. Almost everything else in the system is scoped to one.</summary>
public class Site : AuditableEntity
{
    /// <summary>Short human code used in document numbers — e.g. <c>KLW</c> in <c>HNP-KLW-2418</c>.</summary>
    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;
    public string? AddressLine { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? Pincode { get; set; }

    /// <summary>Free text for now. Becomes a real relationship when projects arrive.</summary>
    public string? ProjectName { get; set; }

    public bool IsActive { get; set; } = true;
}
