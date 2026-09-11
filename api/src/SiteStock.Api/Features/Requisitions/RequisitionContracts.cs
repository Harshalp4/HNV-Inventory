namespace SiteStock.Api.Features.Requisitions;

// ── what the site asks for ───────────────────────────────────────────────────

public record SaveRequisitionRequest(
    Guid SiteId,
    string Priority,
    DateOnly RequiredBy,
    string? Notes,
    IReadOnlyList<SaveRequisitionLineRequest> Lines,
    /// <summary>Which client contract this is for. Optional — general consumables belong to none.</summary>
    Guid? WorkOrderId = null);

public record SaveRequisitionLineRequest(Guid MaterialId, decimal Quantity, string? Notes);

public record TransitionRequest(string? Reason);

// ── what the purchase head fills in ──────────────────────────────────────────

/// <param name="UnitRate">
/// What the supplier is held to, per unit. Ignored when a list rate and a discount are both
/// given — the server derives it from those, so the three figures printed on the order cannot
/// contradict each other.
/// </param>
public record PriceLineRequest(
    Guid LineId,
    Guid AwardedSupplierId,
    decimal UnitRate,
    decimal TaxPercent,
    string? PricingNotes,
    IReadOnlyList<SaveQuoteRequest>? Quotes,
    string? ProductCode = null,
    string? Make = null,
    decimal? ListRate = null,
    decimal? DiscountPercent = null);

public record SaveQuoteRequest(Guid SupplierId, decimal UnitRate, decimal TaxPercent, int? LeadTimeDays, string? Notes);

/// <param name="SupplierNote">Printed in the note box on every order this request produces.</param>
/// <param name="SupplierTerms">
/// Credit agreed for this purchase, per supplier. Anything left out falls back to that
/// supplier's own terms, so sending none keeps today's behaviour exactly.
/// </param>
public record PriceRequisitionRequest(
    IReadOnlyList<PriceLineRequest> Lines,
    string? SupplierNote = null,
    IReadOnlyList<SupplierTermRequest>? SupplierTerms = null,
    /// <summary>
    /// The client contract this spend belongs to, set or corrected while pricing.
    /// </summary>
    /// <remarks>
    /// A supervisor asking for cement is not thinking about which contract pays for it, so
    /// the link is usually still blank by the time it reaches the buyer — and the buyer is
    /// the one who knows. Left null the existing link is kept, so pricing a request that is
    /// already costed cannot quietly unhook it.
    /// </remarks>
    Guid? WorkOrderId = null,
    /// <summary>
    /// False to save the work so far and leave the request where it is.
    /// </summary>
    /// <remarks>
    /// A buyer collects quotes over days, not minutes. Making pricing and sending one
    /// action meant half-finished work had nowhere to live, so it was either kept on paper
    /// or pushed at the owner before it was ready. Saved, a part-priced request stays
    /// waiting for prices and nobody is told anything.
    /// </remarks>
    bool Submit = true);

public record SupplierTermRequest(Guid SupplierId, int PaymentTermsDays);

/// <param name="DefaultPaymentTermsDays">The supplier's own terms, for comparison on screen.</param>
public record SupplierTermDto(
    Guid SupplierId, string SupplierName, int PaymentTermsDays, int DefaultPaymentTermsDays);

// ── responses ────────────────────────────────────────────────────────────────

public record QuoteDto(
    Guid Id, Guid SupplierId, string SupplierName, decimal UnitRate,
    decimal TaxPercent, int? LeadTimeDays, string? Notes, decimal LineTotal, bool IsAwarded);

public record RequisitionLineDto(
    Guid Id,
    Guid MaterialId,
    string MaterialCode,
    string MaterialName,
    string? Specification,
    string UnitCode,
    int UnitDecimalPlaces,
    bool RequiresCertificate,
    decimal Quantity,
    string? Notes,
    Guid? AwardedSupplierId,
    string? AwardedSupplierName,
    decimal? UnitRate,
    decimal? TaxPercent,
    string? PricingNotes,
    /// <summary>The maker's catalogue number for what was quoted.</summary>
    string? ProductCode,
    /// <summary>The brand quoted — Anchor, Polycab, Finolex.</summary>
    string? Make,
    /// <summary>List price before the trade discount, where the quote was given that way.</summary>
    decimal? ListRate,
    decimal? DiscountPercent,
    decimal? LineTotal,
    decimal? TaxAmount,
    decimal? LineTotalWithTax,
    /// <summary>What this material last cost, from the most recent issued order.</summary>
    decimal? LastPaidRate,
    DateTimeOffset? LastPaidOn,
    string? LastPaidSupplierName,
    /// <summary>
    /// What the client's work order covers for this material, and how much of it has already
    /// been ordered. Null when the request is not tied to a contract, or the contract has no
    /// itemised list. Quantities, not money — so a supervisor sees it too.
    /// </summary>
    WorkOrderCover? Cover,
    /// <summary>Set when the site changed this line after sending the requisition on.</summary>
    DateTimeOffset? AmendedAt,
    /// <summary>The quantity before that change, so the screen can show "was 40".</summary>
    decimal? QuantityBefore,
    IReadOnlyList<QuoteDto> Quotes);

/// <param name="Covered">How many the client asked for on the work order.</param>
/// <param name="AlreadyOrdered">Ordered against that contract so far, this request aside.</param>
/// <param name="Left">What is still uncovered. Negative means more has been ordered than asked for.</param>
public record WorkOrderCover(
    string WorkOrderNumber, decimal Covered, decimal AlreadyOrdered, decimal Left, bool OnWorkOrder);

public record RequisitionListItem(
    Guid Id,
    string Number,
    Guid SiteId,
    string SiteCode,
    string SiteName,
    string Status,
    string Priority,
    DateOnly RequiredBy,
    string RequestedByName,
    int LineCount,
    /// <summary>Null for anyone without prices.read — absent, not merely hidden.</summary>
    decimal? EstimatedTotal,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SubmittedAt,
    /// <summary>Hours since it entered the current state — drives the "waiting too long" flag.</summary>
    double? HoursWaiting,
    /// <summary>Set when the site changed it after sending it on. Flagged in the queue.</summary>
    DateTimeOffset? AmendedAt,
    /// <summary>Set when that change landed after somebody had already priced it.</summary>
    DateTimeOffset? AmendedAfterPricingAt);

/// <param name="Tone">
/// normal, warn or bad. Decided here rather than by matching words in the browser: a
/// timeline that colours itself by string comparison goes quietly wrong the first time an
/// event is reworded.
/// </param>
public record TimelineEntry(
    string Event, string? By, DateTimeOffset? At, string? Detail, string Tone = "normal");

public record AmendmentDto(
    string Kind, string? MaterialName, string? Before, string? After,
    string Reason, bool AfterPricing, string ChangedByName, DateTimeOffset ChangedAt);

public record BudgetSnapshot(
    string FinancialYear,
    decimal Allocated,
    decimal CommittedToDate,
    decimal ThisRequisition,
    decimal RemainingAfter,
    double PercentUsedAfter,
    /// <summary>False when nobody has set a budget for this site and year.</summary>
    bool HasBudget,
    /// <summary>NotSet · WithinBudget · NearLimit · OverBudget.</summary>
    string State,
    /// <summary>True when approving needs a typed reason recorded against the owner.</summary>
    bool RequiresOverride,
    string? Message);

public record RequisitionDetail(
    Guid Id,
    string Number,
    Guid SiteId,
    string SiteCode,
    string SiteName,
    string Status,
    string Priority,
    DateOnly RequiredBy,
    string? Notes,
    /// <summary>The buyer's note, printed on every purchase order this request produces.</summary>
    string? SupplierNote,
    /// <summary>Credit agreed per supplier for this purchase, where it differs from theirs.</summary>
    IReadOnlyList<SupplierTermDto> SupplierTerms,
    string RequestedByName,
    Guid? WorkOrderId,
    string? WorkOrderNumber,
    string? WorkOrderTitle,
    string? PricedByName,
    string? DecidedByName,
    string? DecisionReason,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SubmittedAt,
    DateTimeOffset? PricedAt,
    DateTimeOffset? DecidedAt,
    /// <summary>Null rather than zero without prices.read — nothing is not the same as free.</summary>
    decimal? SubTotal,
    decimal? TaxTotal,
    decimal? GrandTotal,
    bool IsEditable,
    /// <summary>
    /// Whether the site may still change it. True while nothing has reached a supplier —
    /// including after approval, as long as every order raised is still sitting unsent.
    /// </summary>
    bool IsAmendable,
    /// <summary>
    /// True when amending would withdraw orders that have already been raised, so the screen
    /// can say so before the supervisor types rather than after they save.
    /// </summary>
    bool AmendingCancelsOrders,
    DateTimeOffset? AmendedAt,
    DateTimeOffset? AmendedAfterPricingAt,
    IReadOnlyList<AmendmentDto> Amendments,
    IReadOnlyList<RequisitionLineDto> Lines,
    IReadOnlyList<TimelineEntry> Timeline,
    /// <summary>Which buttons this user should see. The API enforces the same list anyway.</summary>
    IReadOnlyList<string> AvailableActions,
    /// <summary>Present once priced, so the owner sees the budget impact before deciding.</summary>
    BudgetSnapshot? Budget,
    IReadOnlyList<PurchaseOrderSummary> PurchaseOrders);

public record PurchaseOrderSummary(
    Guid Id, string Number, string SupplierName, string Status, decimal? GrandTotal, DateOnly ExpectedDelivery);

/// <summary>
/// How many requests sit in each state, so the filter chips can say so before anybody picks
/// one. Site-scoped and draft-aware, exactly like the list itself.
/// </summary>
/// <param name="MineToAction">Waiting on the person asking — by permission, not by role.</param>
public record RequisitionCounts(
    int All, int MineToAction,
    int Draft, int Submitted, int Priced, int Approved, int Rejected, int Cancelled);

public record RequisitionQuery
{
    public Guid? SiteId { get; init; }
    public string? Status { get; init; }
    public string? Q { get; init; }
    /// <summary>Only what this user can act on right now — the queue view.</summary>
    public bool? MineToAction { get; init; }
    public int? Page { get; init; }
    public int? PageSize { get; init; }
}

/// <param name="WorkOrderId">Null clears the link, leaving the request uncosted.</param>
public record SetWorkOrderRequest(Guid? WorkOrderId);
