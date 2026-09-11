using SiteStock.Api.Domain.Catalog;
using SiteStock.Api.Domain.Common;
using SiteStock.Api.Domain.Identity;
using SiteStock.Api.Domain.Organisation;
using SiteStock.Api.Domain.Procurement;

namespace SiteStock.Api.Domain.Billing;

public enum InvoiceStatus
{
    /// <summary>Being entered by finance. Not yet matched.</summary>
    Draft = 1,
    /// <summary>Matched clean — order, delivery and bill agree. Ready to pay.</summary>
    Matched = 2,
    /// <summary>Matched with differences somebody has to explain.</summary>
    Variance = 3,
    /// <summary>Every difference resolved, or none found. Payment released.</summary>
    Approved = 4,
    Paid = 5,
    /// <summary>Sent back to the supplier. Nothing will be paid until they re-issue.</summary>
    Disputed = 6,
}

/// <summary>
/// The supplier's bill.
///
/// Typed by finance against a form already filled in from the order and the delivery, so
/// they change only what the supplier billed differently. No OCR, no confidence scores,
/// nothing to tune — the interesting part of this feature was never the reading.
/// </summary>
public class Invoice : AuditableEntity
{
    /// <summary>The supplier's own number, exactly as printed. Not ours.</summary>
    public string SupplierInvoiceNumber { get; set; } = string.Empty;

    public Guid SupplierId { get; set; }
    public Supplier Supplier { get; set; } = null!;

    public Guid PurchaseOrderId { get; set; }
    public PurchaseOrder PurchaseOrder { get; set; } = null!;

    public Guid SiteId { get; set; }
    public Site Site { get; set; } = null!;

    public InvoiceStatus Status { get; set; } = InvoiceStatus.Draft;

    public DateOnly InvoiceDate { get; set; }

    /// <summary>Invoice date plus the credit terms frozen on the order.</summary>
    public DateOnly DueDate { get; set; }

    public decimal SubTotal { get; set; }
    public decimal TaxTotal { get; set; }
    public decimal GrandTotal { get; set; }

    /// <summary>What we actually owe once the differences are settled. Set by the match.</summary>
    public decimal PayableAmount { get; set; }

    public Guid EnteredById { get; set; }
    public User EnteredBy { get; set; } = null!;

    public DateTimeOffset? MatchedAt { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public Guid? ApprovedById { get; set; }
    public User? ApprovedBy { get; set; }

    public DateTimeOffset? PaidAt { get; set; }
    public string? PaymentReference { get; set; }

    public string? Notes { get; set; }

    public ICollection<InvoiceLine> Lines { get; set; } = [];
    public ICollection<InvoiceVariance> Variances { get; set; } = [];

    /// <summary>Every payment made against this bill. Part payments are normal here.</summary>
    public ICollection<SupplierPayment> Payments { get; set; } = [];

    public decimal AmountPaid => Payments.Sum(p => p.Amount);
    public decimal Outstanding => PayableAmount - AmountPaid;

    public bool IsEditable => Status is InvoiceStatus.Draft or InvoiceStatus.Variance;

    public bool HasOpenVariances => Variances.Any(v => v.ResolvedAt is null);
}

public class InvoiceLine : AuditableEntity
{
    public Guid InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;

    /// <summary>Null when the supplier billed something that was never ordered.</summary>
    public Guid? PurchaseOrderLineId { get; set; }
    public PurchaseOrderLine? PurchaseOrderLine { get; set; }

    public Guid MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    /// <summary>
    /// What the supplier billed, exactly as printed. <b>Never overwritten with a corrected
    /// figure</b> — the variance is the difference between what was billed and what was
    /// owed, so both have to survive.
    /// </summary>
    public decimal BilledQuantity { get; set; }
    public decimal BilledRate { get; set; }
    public decimal TaxPercent { get; set; }

    public decimal LineTotal { get; set; }
    public decimal TaxAmount { get; set; }

    public string? Notes { get; set; }
}
