using SiteStock.Api.Domain.Identity;

namespace SiteStock.Api.Domain.Procurement;

public enum AmendmentKind
{
    LineAdded = 1,
    LineRemoved = 2,
    QuantityChanged = 3,
    LineNoteChanged = 4,
    NeededByChanged = 5,
    PriorityChanged = 6,
    NoteChanged = 7,
}

/// <summary>
/// One change the site made to a requisition <b>after</b> it had already been sent on.
///
/// <para>A separate row per change rather than a version of the whole document. The question
/// people actually ask is "who put the quantity up, and when" — and a row that says exactly
/// that answers it without anybody diffing two snapshots.</para>
///
/// <para>Names are copied in rather than joined to. A material renamed next year must not
/// silently rewrite what the history says was ordered this year.</para>
/// </summary>
public class RequisitionAmendment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid RequisitionId { get; set; }
    public Requisition Requisition { get; set; } = null!;

    public AmendmentKind Kind { get; set; }

    /// <summary>Snapshot of the material's name, for the line-level kinds.</summary>
    public string? MaterialName { get; set; }
    public Guid? MaterialId { get; set; }

    /// <summary>Written as they should read on screen — "40 BAG", "12 Sep", "Urgent".</summary>
    public string? Before { get; set; }
    public string? After { get; set; }

    /// <summary>Why the site changed it. Required — a change without one is an argument later.</summary>
    public string Reason { get; set; } = string.Empty;

    /// <summary>
    /// True when the requisition had already been priced. These are the ones that matter:
    /// somebody had quoted a rate against a quantity that no longer exists.
    /// </summary>
    public bool AfterPricing { get; set; }

    public Guid ChangedById { get; set; }
    public User ChangedBy { get; set; } = null!;
    public DateTimeOffset ChangedAt { get; set; }
}
