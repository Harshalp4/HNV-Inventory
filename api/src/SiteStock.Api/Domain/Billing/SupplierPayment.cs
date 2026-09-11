using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Organisation;

namespace SiteStock.Api.Domain.Billing;

public enum PaymentMethod
{
    BankTransfer = 1,
    Cheque = 2,
    Upi = 3,
    Cash = 4,
    Adjustment = 5,
    Other = 99,
}

/// <summary>
/// Money that actually left the account, against one supplier bill.
///
/// <para>Releasing a bill for payment and paying it are two different acts, often days or
/// weeks apart and done by two different people. Before this the system recorded only the
/// first, so "owed to suppliers" counted everything ever approved and never came down —
/// which is worse than not showing the figure at all.</para>
///
/// <para>Many rows to one bill on purpose. Part payments are how this trade actually works:
/// half on delivery, the balance after the site signs off, and a retention held back until
/// the defect period ends. A single paid flag cannot say any of that.</para>
/// </summary>
public class SupplierPayment : AuditableEntity
{
    public Guid InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;

    /// <summary>Copied from the bill so a supplier ledger does not need the join.</summary>
    public Guid SupplierId { get; set; }
    public Supplier Supplier { get; set; } = null!;

    public Guid SiteId { get; set; }
    public Site Site { get; set; } = null!;

    public decimal Amount { get; set; }

    /// <summary>The date on the bank statement, not the day somebody typed it in.</summary>
    public DateOnly PaidOn { get; set; }

    public PaymentMethod Method { get; set; }

    /// <summary>UTR, cheque number or UPI reference — what the bank will be asked for.</summary>
    public string? Reference { get; set; }

    public string? Notes { get; set; }

    public Guid RecordedById { get; set; }
    public User RecordedBy { get; set; } = null!;
}
