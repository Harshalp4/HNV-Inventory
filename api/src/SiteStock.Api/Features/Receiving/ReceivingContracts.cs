namespace SiteStock.Api.Features.Receiving;

public record StartReceiptRequest(Guid PurchaseOrderId);

public record SaveReceiptRequest(
    string? ChallanNumber,
    DateOnly? ChallanDate,
    string? VehicleNumber,
    string? DriverName,
    bool CheckedMaterialMatches,
    bool CheckedQuantityMatches,
    bool CheckedConditionAcceptable,
    bool CheckedCertificatePresent,
    string? Notes,
    IReadOnlyList<SaveReceiptLineRequest> Lines);

public record SaveReceiptLineRequest(Guid LineId, decimal ReceivedQuantity, decimal AcceptedQuantity, string? Notes);

/// <param name="Shortfall">HoldOpen or CloseShort. Required when less arrived than was ordered.</param>
public record AcceptReceiptRequest(string? Shortfall);

public record RejectReceiptRequest(string Reason, string Notes);

public record ReceiptLineDto(
    Guid Id, Guid PurchaseOrderLineId, Guid MaterialId,
    string MaterialCode, string MaterialName, string? Specification,
    string UnitCode, int UnitDecimalPlaces, bool RequiresCertificate,
    decimal OrderedQuantity, decimal AlreadyReceived, decimal OutstandingQuantity,
    decimal ReceivedQuantity, decimal AcceptedQuantity,
    decimal RejectedQuantity, decimal ShortQuantity,
    decimal UnitRate, string? Notes);

public record ReceiptDocumentDto(
    Guid Id, string Kind, string FileName, string ContentType, long SizeBytes,
    string? Caption, DateTimeOffset UploadedAt, string UploadedByName);

public record GoodsReceiptListItem(
    Guid Id, string Number, string Status, Guid SiteId, string SiteCode, string SiteName,
    Guid PurchaseOrderId, string PurchaseOrderNumber, string SupplierName,
    DateTimeOffset ReceivedAt, string ReceivedByName, int LineCount,
    bool HasShortfall, bool HasRejection);

public record GoodsReceiptDetail(
    Guid Id, string Number, string Status,
    Guid SiteId, string SiteCode, string SiteName,
    Guid PurchaseOrderId, string PurchaseOrderNumber, string SupplierName,
    string? SupplierPhone,
    DateTimeOffset ReceivedAt, string ReceivedByName,
    string? ChallanNumber, DateOnly? ChallanDate, string? VehicleNumber, string? DriverName,
    bool CheckedMaterialMatches, bool CheckedQuantityMatches,
    bool CheckedConditionAcceptable, bool CheckedCertificatePresent,
    string Shortfall, string? RejectionReason, string? RejectionNotes, string? Notes,
    DateTimeOffset? DecidedAt, bool IsEditable,
    IReadOnlyList<ReceiptLineDto> Lines,
    IReadOnlyList<ReceiptDocumentDto> Documents,
    /// <summary>Set when any line is short — the supervisor must choose before accepting.</summary>
    bool NeedsShortfallDecision,
    /// <summary>Names of materials whose certificate has not been attached yet.</summary>
    IReadOnlyList<string> MissingCertificates);
