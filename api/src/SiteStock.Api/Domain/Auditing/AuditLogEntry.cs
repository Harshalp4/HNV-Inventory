namespace SiteStock.Api.Domain.Auditing;

public enum AuditAction { Created = 1, Updated = 2, Deleted = 3 }

/// <summary>
/// Append-only. Nothing in the application updates or deletes a row here, and the
/// entity configuration does not give EF a way to. "Who did what when" is a query,
/// not an archaeology exercise.
/// </summary>
public class AuditLogEntry
{
    public long Id { get; set; }

    public string EntityName { get; set; } = string.Empty;
    public string EntityId { get; set; } = string.Empty;
    public AuditAction Action { get; set; }

    /// <summary>Changed property names and their before/after values, as jsonb.</summary>
    public string Changes { get; set; } = "{}";

    public Guid? ChangedBy { get; set; }
    public string? ChangedByName { get; set; }
    public DateTimeOffset ChangedAt { get; set; }

    /// <summary>Ties the row back to the request in the logs.</summary>
    public string? CorrelationId { get; set; }
}
