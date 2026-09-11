using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Domain.Inventory;

public enum MovementType
{
    /// <summary>Accepted at the gate on a goods receipt.</summary>
    Received = 1,
    /// <summary>Used on site.</summary>
    Consumed = 2,
    /// <summary>Arrived from another site.</summary>
    TransferIn = 3,
    /// <summary>Sent to another site.</summary>
    TransferOut = 4,
    /// <summary>A physical count differed from the books, corrected with a reason.</summary>
    Adjustment = 5,
    /// <summary>Opening balance at go-live.</summary>
    Opening = 6,
    /// <summary>Returned to the supplier after acceptance.</summary>
    ReturnedToSupplier = 7,

    /// <summary>
    /// Handed to somebody on site — a mason, a gang, a labour contractor. It has left the
    /// store either way; whether it is expected back is decided by the material, not here.
    /// </summary>
    Issued = 8,

    /// <summary>Brought back by whoever it was issued to.</summary>
    ReturnedFromIssue = 9,

    /// <summary>Gone and not coming back — damaged, lost or stolen. Written off deliberately.</summary>
    WrittenOff = 10,
}

/// <summary>
/// Why the books and the yard disagreed, or why something was written off.
///
/// <para>A coded reason rather than free text alone, because the useful question is "how much
/// have we lost to theft this year" and no amount of reading sentences answers it. Every ERP
/// that handles this well does the same — SAP has a reason-for-movement on its scrapping
/// movement type, Odoo posts scrap to a named loss location — and the reason a list beats a
/// text box is that a list can be counted.</para>
///
/// <para><see cref="Unexplained"/> exists on purpose and is watched on purpose: a count that
/// nobody can account for is a real answer the first time and a signal the fourth.</para>
/// </summary>
public enum AdjustmentReason
{
    /// <summary>Recounted and the books were simply wrong. No cause found, none suspected.</summary>
    Miscount = 1,

    /// <summary>Broken, spoiled or unusable. Still on site, but no longer stock.</summary>
    Damaged = 2,

    /// <summary>Cannot be found. Nobody is saying it was taken.</summary>
    Lost = 3,

    /// <summary>Taken. Somebody is saying it was.</summary>
    Stolen = 4,

    /// <summary>Cement set, paint dried out, concrete returned — normal loss in the work.</summary>
    Wastage = 5,

    /// <summary>Keyed in wrong: the wrong quantity, the wrong material, the wrong unit.</summary>
    EntryError = 6,

    /// <summary>Past its shelf life.</summary>
    Expired = 7,

    /// <summary>More was found than the books said.</summary>
    FoundExtra = 8,

    /// <summary>Counted short and nobody can say why. Deliberately uncomfortable to choose.</summary>
    Unexplained = 9,
}

/// <summary>
/// The stock ledger. <b>Every row is immutable</b> — nothing in the application updates or
/// deletes one, and there is no mutable "quantity on hand" column anywhere in the schema.
/// Current stock is the sum of the rows.
///
/// This is the single most important design decision in the system. When somebody asks in
/// March why the cement count looks wrong, the answer is a query. Keep a running total in a
/// column instead and the answer is a shrug, because the number will have drifted and
/// nothing records how.
/// </summary>
public class StockMovement
{
    public long Id { get; set; }

    public Guid SiteId { get; set; }
    public Site Site { get; set; } = null!;

    public Guid MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    public MovementType Type { get; set; }

    /// <summary>
    /// Signed. Positive adds to stock, negative removes it. Storing the sign rather than a
    /// separate in/out flag means the balance is a plain SUM that cannot be got wrong.
    /// </summary>
    public decimal Quantity { get; set; }

    /// <summary>What caused it — a goods receipt, a consumption record, a transfer.</summary>
    public string SourceType { get; set; } = string.Empty;
    public Guid SourceId { get; set; }

    /// <summary>Human reference of the source, e.g. <c>GRN-KLW-0180</c>, for the stock history screen.</summary>
    public string? SourceReference { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public Guid RecordedById { get; set; }
    public User RecordedBy { get; set; } = null!;

    public string? Notes { get; set; }
    /// <summary>
    /// Why, for an adjustment or a write-off. Null for everything else — a delivery does not
    /// need a reason, it needs a goods receipt.
    /// </summary>
    public AdjustmentReason? Reason { get; set; }

}
