namespace SiteStock.Api.Domain.Common;

/// <summary>
/// Every persisted entity carries these. They are filled by <c>AuditSaveChangesInterceptor</c>
/// on SaveChanges — never by hand in a service, so they cannot be forgotten.
/// </summary>
public abstract class AuditableEntity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public DateTimeOffset CreatedAt { get; set; }
    public Guid? CreatedBy { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}
