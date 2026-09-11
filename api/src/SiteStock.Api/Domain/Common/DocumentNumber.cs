namespace SiteStock.Api.Domain.Common;

/// <summary>
/// One row per numbering scope, e.g. <c>REQ-KLW</c> or <c>HNP-KLW</c>.
///
/// Allocated with an atomic <c>UPDATE … RETURNING</c> inside the same transaction as the
/// document itself, so two people submitting at the same moment cannot be handed the same
/// number. A Postgres sequence would be faster but would also skip numbers on rollback,
/// and a purchase order register with gaps in it is a conversation nobody wants to have
/// with an auditor.
/// </summary>
public class DocumentNumber
{
    public string Scope { get; set; } = string.Empty;
    public int NextValue { get; set; } = 1;
}
