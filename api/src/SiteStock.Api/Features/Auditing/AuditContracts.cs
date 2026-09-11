namespace SiteStock.Api.Features.Auditing;

/// <param name="Field">The name a person would use, not the column name.</param>
public record AuditFieldChange(string Field, string? From, string? To);

/// <param name="RecordType">"Purchase order", "Supplier" — what was touched, in words.</param>
/// <param name="Summary">One line, so a list of these reads without opening anything.</param>
/// <param name="Link">Where to open the record, when it has a screen of its own.</param>
public record AuditEntryDto(
    long Id,
    string RecordType,
    string EntityName,
    string EntityId,
    string Action,
    string Summary,
    IReadOnlyList<AuditFieldChange> Fields,
    string? ChangedByName,
    DateTimeOffset ChangedAt,
    string? Link);

public record AuditQuery
{
    /// <summary>Raw entity name, as stored — "Supplier", "PurchaseOrder".</summary>
    public string? Entity { get; init; }
    public string? EntityId { get; init; }
    public Guid? ChangedBy { get; init; }
    public DateOnly? From { get; init; }
    public DateOnly? To { get; init; }
    /// <summary>Free text against the person's name or the changed values.</summary>
    public string? Q { get; init; }
    public int? Page { get; init; }
    public int? PageSize { get; init; }
}

/// <param name="Value">The raw entity name to filter by.</param>
public record AuditRecordType(string Value, string Label);
