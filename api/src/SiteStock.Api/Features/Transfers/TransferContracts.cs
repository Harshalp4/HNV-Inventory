namespace SiteStock.Api.Features.Transfers;

/// <summary>What another site could genuinely let go of, and what it would save.</summary>
public record SpareStockDto(
    Guid SiteId, string SiteCode, string SiteName,
    Guid MaterialId, string MaterialCode, string MaterialName, string? Specification,
    string UnitCode, int UnitDecimalPlaces,
    decimal OnHand,
    /// <summary>The holding site's own warn-me level. Nothing below this is offered.</summary>
    decimal? ReorderLevel,
    /// <summary>On hand less the holding site's own reorder level. Never negative.</summary>
    decimal Spare,
    /// <summary>Last purchase rate at the holding site — what buying it new would cost.</summary>
    decimal? LastPaidRate,
    /// <summary>Spare quantity at the last paid rate. What a transfer would avoid spending.</summary>
    decimal AvoidedSpend);

public record CreateTransferRequest(
    Guid FromSiteId, Guid ToSiteId, DateOnly? NeededBy, string? Reason,
    IReadOnlyList<TransferLineRequest> Lines);

public record TransferLineRequest(Guid MaterialId, decimal Quantity, string? Notes);

public record DecideTransferRequest(
    bool Approve, string? Notes, IReadOnlyList<ApprovedLineRequest>? Lines);

/// <param name="Quantity">May be less than asked. Zero drops the line.</param>
public record ApprovedLineRequest(Guid LineId, decimal Quantity);

public record DispatchTransferRequest(
    string? VehicleNumber, decimal? TransportCost, string? Notes,
    IReadOnlyList<DispatchedLineRequest> Lines);

public record DispatchedLineRequest(Guid LineId, decimal Quantity);

public record ReceiveTransferRequest(
    string? Notes, IReadOnlyList<ReceivedLineRequest> Lines);

public record ReceivedLineRequest(Guid LineId, decimal Quantity, string? Notes);

public record TransferLineDto(
    Guid Id, Guid MaterialId, string MaterialCode, string MaterialName, string? Specification,
    string UnitCode, int UnitDecimalPlaces,
    decimal RequestedQuantity, decimal? ApprovedQuantity,
    decimal? DispatchedQuantity, decimal? ReceivedQuantity,
    decimal? UnitValue, decimal ShortfallQuantity,
    /// <summary>What the holding site has right now, so an approver is not guessing.</summary>
    decimal AvailableAtSource,
    string? Notes);

public record TransferListItem(
    Guid Id, string Number, string Status,
    Guid FromSiteId, string FromSiteName, Guid ToSiteId, string ToSiteName,
    string RequestedByName, DateTimeOffset CreatedAt, DateOnly? NeededBy,
    int LineCount, decimal EstimatedValue,
    /// <summary>True when this user is on the answering end of it.</summary>
    bool NeedsMyAnswer);

public record TransferDetail(
    Guid Id, string Number, string Status,
    Guid FromSiteId, string FromSiteName, Guid ToSiteId, string ToSiteName,
    string RequestedByName, DateTimeOffset CreatedAt,
    DateOnly? NeededBy, string? Reason,
    string? DecidedByName, DateTimeOffset? DecidedAt, string? DecisionNotes,
    string? DispatchedByName, DateTimeOffset? DispatchedAt, string? VehicleNumber,
    string? ReceivedByName, DateTimeOffset? ReceivedAt,
    decimal? TransportCost, string? Notes,
    decimal EstimatedValue,
    /// <summary>Material value less transport. Negative means buying new would be cheaper.</summary>
    decimal NetSaving,
    IReadOnlyList<TransferLineDto> Lines,
    IReadOnlyList<string> AvailableActions);
