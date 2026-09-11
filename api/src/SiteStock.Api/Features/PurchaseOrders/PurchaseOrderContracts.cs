namespace SiteStock.Api.Features.PurchaseOrders;

public record PurchaseOrderLineDto(
    Guid Id, Guid MaterialId, string MaterialCode, string MaterialName, string? Specification,
    string UnitCode, int UnitDecimalPlaces, bool RequiresCertificate,
    /// <summary>Printed against each line — the supplier's invoice has to agree with it.</summary>
    string? HsnCode,
    decimal Quantity,
    /// <summary>
    /// Taken into stock against this line so far, across every accepted delivery.
    ///
    /// <para>Declared straight after <c>Quantity</c> deliberately. This is a positional
    /// record: putting it before meant the constructor call still compiled with the two
    /// swapped, and every order showed nothing ordered and everything received.</para>
    /// </summary>
    decimal ReceivedQuantity,
    /// <summary>The maker's catalogue number, as agreed with the supplier.</summary>
    string? ProductCode,
    /// <summary>The brand the supplier is held to.</summary>
    string? Make,
    /// <summary>Rates and totals are null for anyone without prices.read.</summary>
    decimal? ListRate, decimal? DiscountPercent,
    decimal? UnitRate, decimal? TaxPercent,
    decimal? LineTotal, decimal? TaxAmount, string? Notes);

public record CommunicationDto(
    Guid Id, string Channel, string Status, string Recipient,
    DateTimeOffset SentAt, string SentByName, string? Notes, string? FailureReason);

public record PurchaseOrderListItem(
    Guid Id, string Number, string Status, Guid SiteId, string SiteCode, string SiteName,
    Guid SupplierId, string SupplierName, DateTimeOffset IssuedAt, DateOnly ExpectedDelivery,
    decimal? GrandTotal, int LineCount, bool HasBeenSent, string RequisitionNumber,
    Guid? WorkOrderId, string? WorkOrderNumber,
    /// <summary>How many deliveries have been counted in against this order.</summary>
    int DeliveryCount,
    /// <summary>Lines with the full ordered quantity in stock, out of <c>LineCount</c>.</summary>
    int LinesFullyReceived,
    /// <summary>
    /// What is actually on the order, in words — "16A modular switch, 2.5 sq mm wire +3 more".
    /// A supervisor at the gate is looking at a lorry, not at an order number: the goods are
    /// how he tells one pending delivery from another.
    /// </summary>
    string ItemSummary);

/// <summary>The contract this order is costed against, and how it stands.</summary>
public record WorkOrderSummary(
    Guid Id, string Number, string Title, string ClientName, string Status,
    decimal ContractValue, decimal Committed, decimal Remaining, double PercentCommitted,
    /// <summary>
    /// The client's own work order and any amendments, so the order can be read beside the
    /// contract it was raised under without leaving the page.
    /// </summary>
    IReadOnlyList<ReceiptFileDto> Documents);

public record PurchaseOrderDetail(
    Guid Id, string Number, string Status,
    Guid RequisitionId, string RequisitionNumber,
    Guid SiteId, string SiteCode, string SiteName,
    Guid SupplierId, string SupplierName, string? SupplierGstin,
    string? SupplierContact, string? SupplierPhone, string? SupplierEmail,
    DateTimeOffset IssuedAt, string IssuedByName, DateOnly ExpectedDelivery,
    int PaymentTermsDays, string? DeliveryInstructions,
    /// <summary>The buyer's note, printed on the order above the terms.</summary>
    string? Notes,
    decimal? SubTotal, decimal? TaxTotal, decimal? GrandTotal,
    IReadOnlyList<PurchaseOrderLineDto> Lines,
    IReadOnlyList<CommunicationDto> Communications,
    WorkOrderSummary? WorkOrder,
    /// <summary>Set when the order was withdrawn before it ever reached the supplier.</summary>
    DateTimeOffset? CancelledAt,
    string? CancellationReason,
    /// <summary>Who withdrew it. An order that cancelled itself is not an audit trail.</summary>
    string? CancelledByName,
    /// <summary>
    /// What has actually turned up against this order, newest first, with whatever the
    /// supervisor photographed at the gate. An order is only half a record without it.
    /// </summary>
    IReadOnlyList<PurchaseOrderReceiptDto> Receipts,
    /// <summary>Every change made since it was raised, newest first.</summary>
    IReadOnlyList<OrderChangeDto> Changes,
    /// <summary>
    /// True when the order was changed after the last time it went out, so the copy the
    /// supplier is holding no longer matches this one.
    /// </summary>
    bool SupplierCopyStale,
    /// <summary>NotRequired · Pending · Approved · ChangesRequested.</summary>
    string SendApproval,
    DateTimeOffset? SendApprovalDecidedAt,
    string? SendApprovalDecidedByName,
    /// <summary>What the approver said. Required when they send it back.</summary>
    string? SendApprovalNote,
    /// <summary>Whether the person reading this is one of the people who may approve it.</summary>
    bool CanApproveSend,
    /// <summary>Who it is waiting on, in words, so the buyer knows whom to chase.</summary>
    string? AwaitingApprovalFrom,
    /// <summary>
    /// Why the materials on this order cannot be changed, or null when they can. Answered
    /// here so the order's own screen can offer the amendment — or say why it cannot —
    /// without sending anybody to the requisition list to find out.
    /// </summary>
    string? AmendBlockedReason);

/// <param name="Status">Draft while it is being counted, then Accepted or Rejected.</param>
public record PurchaseOrderReceiptDto(
    Guid Id, string Number, string Status,
    DateTimeOffset ReceivedAt, string ReceivedByName,
    string? ChallanNumber, string? VehicleNumber,
    decimal ReceivedQuantity, decimal AcceptedQuantity,
    bool HasShortfall, bool HasRejection,
    IReadOnlyList<ReceiptFileDto> Documents);

/// <param name="Kind">TestCertificate, DeliveryChallan or RejectionPhoto.</param>
public record ReceiptFileDto(
    Guid Id, string Kind, string FileName, string ContentType, long SizeBytes, string? Caption);

/// <param name="Channel">Email, WhatsApp, Phone or HandDelivered.</param>
/// <param name="Recipient">Address, number, or the name of whoever took it.</param>
/// <summary>Everything the printed order needs that is not already on the order itself.</summary>
public record PrintablePurchaseOrder(
    PurchaseOrderDetail Order,
    string CompanyName, string? CompanyGstin, string? CompanyAddress,
    string? CompanyPhone, string? CompanyEmail,
    /// <summary>A second address, printed beside the first when the company has one.</summary>
    string? CompanyEmailAlternate,
    /// <summary>Where the load actually goes — the site, not the registered office.</summary>
    string DeliverySiteName, string? DeliveryAddress,
    string? ContactPerson, string? ContactPhone,
    /// <summary>Indian convention: the total spelled out, so a figure cannot be altered.</summary>
    string AmountInWords,
    decimal Cgst, decimal Sgst);

/// <summary>
/// What can still be changed on an order that has not gone out yet.
///
/// <para>Not the lines or the rates: those came through the approval gate, and letting them
/// be edited afterwards would make the gate decorative. They are changed by amending the
/// requisition, which withdraws the order and raises a new one. What is here is what the
/// buyer settles with the supplier on the phone after the owner has approved the spend —
/// when it is wanted, on what credit, and what to tell them.</para>
/// </summary>
/// <param name="Reason">
/// What changed and why. Required once the supplier holds a copy — somebody has to be told,
/// and the record has to say what they were told.
/// </param>
public record EditPurchaseOrderRequest(
    DateOnly ExpectedDelivery, int PaymentTermsDays, string? Notes, string? Reason = null);

/// <param name="AfterSending">True when the supplier already held a copy at the time.</param>
public record OrderChangeDto(
    Guid Id, string Summary, string? Reason,
    DateTimeOffset ChangedAt, string ChangedByName, bool AfterSending);

/// <summary>
/// New figures for the order's lines, and why.
///
/// <para>Quantities are not here. What is being bought was approved; how much it costs is
/// what the supplier moves on the phone, and a buyer who cannot record that ends up with the
/// real price living somewhere else.</para>
/// </summary>
/// <param name="Reason">Required. This changes money the owner has already approved.</param>
public record RepriceOrderRequest(
    IReadOnlyList<RepriceLineRequest> Lines, string Reason);

public record RepriceLineRequest(
    Guid LineId,
    decimal UnitRate,
    decimal TaxPercent,
    string? ProductCode = null,
    string? Make = null,
    decimal? ListRate = null,
    decimal? DiscountPercent = null);

/// <param name="Note">Required when sending it back; optional when approving.</param>
public record SendApprovalDecision(string? Note);

public record SendPurchaseOrderRequest(string Channel, string Recipient, string? Notes);

/// <summary>
/// "I sent this myself." Recorded, never transmitted — the buyer printed it and handed it
/// over, read it out on the phone, or sent it from their own mailbox because ours would not
/// go. Separate from <c>SendPurchaseOrderRequest</c> on purpose: "send it" and "I already
/// sent it" are different acts, and a log that blurs them is a log nobody trusts.
/// </summary>
/// <param name="Channel">Email, WhatsApp, Phone, HandDelivered or Other.</param>
/// <param name="Recipient">Who it went to — a name, a number, an address.</param>
/// <param name="Notes">How it went. Required for Other, where the channel says nothing.</param>
public record RecordSentRequest(string Channel, string Recipient, string? Notes);

/// <param name="SupplierPhone">Ten digits, for the wa.me deep link. Null if we do not have one.</param>
public record ShareTextResult(string Number, string? SupplierPhone, string Text);

public record PurchaseOrderQuery
{
    public Guid? SiteId { get; init; }
    public Guid? SupplierId { get; init; }
    public string? Status { get; init; }
    public string? Q { get; init; }
    public int? Page { get; init; }
    public int? PageSize { get; init; }
}
