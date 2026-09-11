namespace SiteStock.Api.Features.Invoices;

/// <summary>Opens an entry form already filled in from the order and what was accepted.</summary>
public record StartInvoiceRequest(Guid PurchaseOrderId);

public record SaveInvoiceRequest(
    string SupplierInvoiceNumber,
    DateOnly InvoiceDate,
    string? Notes,
    IReadOnlyList<SaveInvoiceLineRequest> Lines);

public record SaveInvoiceLineRequest(
    Guid? PurchaseOrderLineId, Guid MaterialId,
    decimal BilledQuantity, decimal BilledRate, decimal TaxPercent, string? Notes);

public record ResolveVarianceRequest(string Resolution, string Notes);

public record ReleasePaymentRequest(string? Reference);

/// <param name="Method">BankTransfer, Cheque, Upi, Cash, Adjustment or Other.</param>
/// <param name="PaidOn">The date on the bank statement, not the day it was keyed in.</param>
/// <param name="Reference">UTR, cheque number or UPI reference.</param>
public record RecordPaymentRequest(
    decimal Amount, DateOnly PaidOn, string Method, string? Reference, string? Notes);

public record PaymentDto(
    Guid Id, decimal Amount, DateOnly PaidOn, string Method,
    string? Reference, string? Notes, string RecordedByName, DateTimeOffset RecordedAt);

public record InvoiceLineDto(
    Guid Id, Guid? PurchaseOrderLineId, Guid MaterialId,
    string MaterialCode, string MaterialName, string UnitCode, int UnitDecimalPlaces,
    decimal OrderedQuantity, decimal OrderedRate, decimal OrderedTaxPercent,
    decimal AcceptedQuantity,
    decimal BilledQuantity, decimal BilledRate, decimal TaxPercent,
    decimal LineTotal, decimal TaxAmount, string? Notes,
    /// <summary>True when this line's three figures agree.</summary>
    bool Matches);

public record VarianceDto(
    Guid Id, string Type, string TypeLabel, string? MaterialName,
    decimal ExpectedValue, decimal BilledValue, decimal DifferenceAmount,
    string Description, string? Resolution, string? ResolutionNotes,
    DateTimeOffset? ResolvedAt, string? ResolvedByName, bool IsOpen);

public record InvoiceListItem(
    Guid Id, string SupplierInvoiceNumber, string Status,
    Guid SupplierId, string SupplierName,
    Guid PurchaseOrderId, string PurchaseOrderNumber,
    string SiteName, DateOnly InvoiceDate, DateOnly DueDate,
    decimal GrandTotal, decimal PayableAmount,
    int OpenVariances, decimal VarianceAmount,
    /// <summary>Negative once the due date has passed.</summary>
    int DaysUntilDue);

public record InvoiceDetail(
    Guid Id, string SupplierInvoiceNumber, string Status,
    Guid SupplierId, string SupplierName, string? SupplierGstin,
    Guid PurchaseOrderId, string PurchaseOrderNumber,
    Guid SiteId, string SiteName,
    DateOnly InvoiceDate, DateOnly DueDate, int PaymentTermsDays,
    decimal OrderTotal, decimal AcceptedValue,
    decimal SubTotal, decimal TaxTotal, decimal GrandTotal, decimal PayableAmount,
    string EnteredByName, DateTimeOffset? MatchedAt,
    string? ApprovedByName, DateTimeOffset? ApprovedAt,
    DateTimeOffset? PaidAt, string? PaymentReference,
    string? Notes, bool IsEditable,
    IReadOnlyList<InvoiceLineDto> Lines,
    IReadOnlyList<VarianceDto> Variances,
    /// <summary>Every payment made against this bill, oldest first.</summary>
    IReadOnlyList<PaymentDto> Payments,
    /// <summary>What has actually gone out, and what is still owed on this bill.</summary>
    decimal AmountPaid, decimal Outstanding,
    /// <summary>Payment is blocked while this is true.</summary>
    bool HasOpenVariances,
    IReadOnlyList<string> AvailableActions);

public record InvoiceQuery
{
    public Guid? SiteId { get; init; }
    public string? Status { get; init; }
    public string? Q { get; init; }
    /// <summary>Only bills with something unresolved — the finance queue.</summary>
    public bool? NeedsAttention { get; init; }
    public int? Page { get; init; }
    public int? PageSize { get; init; }
}
