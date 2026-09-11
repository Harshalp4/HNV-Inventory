using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Identity;

namespace SiteStock.Api.Domain.Billing;

/// <summary>The six kinds of disagreement, from the specification.</summary>
public enum VarianceType
{
    /// <summary>Billed for more than was accepted at the gate.</summary>
    QuantityMismatch = 1,
    /// <summary>Billed at a rate other than the one agreed on the order.</summary>
    PriceMismatch = 2,
    /// <summary>Billed for something that is not on the order at all.</summary>
    MissingItems = 3,
    /// <summary>Quoted an order number that does not exist, or belongs elsewhere.</summary>
    WrongPoReference = 4,
    /// <summary>GST charged at a different rate than agreed.</summary>
    TaxMismatch = 5,
    /// <summary>This supplier has already billed under this number.</summary>
    DuplicateInvoice = 6,
}

/// <summary>How a difference was settled.</summary>
public enum VarianceResolution
{
    /// <summary>We were wrong — pay what the supplier billed.</summary>
    AcceptSupplierFigure = 1,
    /// <summary>They were wrong — pay what the order and delivery say.</summary>
    PayOurFigure = 2,
    /// <summary>The supplier will issue a credit note for the difference.</summary>
    AwaitCreditNote = 3,
    /// <summary>Send the whole bill back. Nothing is paid until they re-issue.</summary>
    DisputeWithSupplier = 4,
}

/// <summary>
/// One disagreement between the order, the delivery and the bill.
///
/// <para>Resolution is a row, not a comment field: what was decided, by whom, when and why,
/// retrievable months later when somebody asks why a supplier was paid ₹9,856 less than
/// they invoiced.</para>
/// </summary>
public class InvoiceVariance : AuditableEntity
{
    public Guid InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;

    /// <summary>Null for whole-invoice problems like a duplicate number.</summary>
    public Guid? InvoiceLineId { get; set; }
    public InvoiceLine? InvoiceLine { get; set; }

    public VarianceType Type { get; set; }

    /// <summary>What the material is called, kept so the row reads without a join.</summary>
    public string? MaterialName { get; set; }

    /// <summary>What the order and the delivery say it should be.</summary>
    public decimal ExpectedValue { get; set; }

    /// <summary>What the supplier billed.</summary>
    public decimal BilledValue { get; set; }

    /// <summary>The money at stake. Positive means they billed us too much.</summary>
    public decimal DifferenceAmount { get; set; }

    /// <summary>Written at match time, in the words somebody would use to explain it.</summary>
    public string Description { get; set; } = string.Empty;

    public VarianceResolution? Resolution { get; set; }
    public string? ResolutionNotes { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public Guid? ResolvedById { get; set; }
    public User? ResolvedBy { get; set; }

    public bool IsOpen => ResolvedAt is null;
}

/// <summary>
/// The owner going past a budget that would otherwise have blocked an approval.
///
/// A separate table rather than a flag, because the interesting questions are "how often
/// does this happen" and "on whose authority" — and neither is answerable from a boolean.
/// </summary>
public class BudgetOverride : AuditableEntity
{
    public Guid SiteId { get; set; }
    public string FinancialYear { get; set; } = string.Empty;

    /// <summary>The requisition that triggered it.</summary>
    public Guid RequisitionId { get; set; }

    public decimal AmountOverBudget { get; set; }

    /// <summary>Mandatory, typed, and recorded against the owner's name.</summary>
    public string Reason { get; set; } = string.Empty;

    public Guid ApprovedById { get; set; }
    public User ApprovedBy { get; set; } = null!;
}
