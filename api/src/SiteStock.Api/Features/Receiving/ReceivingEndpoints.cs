using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Documents;
using SiteStock.Api.Features.Documents;
using SiteStock.Api.Features.Inventory;

namespace SiteStock.Api.Features.Receiving;

public static class ReceivingEndpoints
{
    public static IEndpointRouteBuilder MapReceivingEndpoints(this IEndpointRouteBuilder app)
    {
        // ── goods receipts ───────────────────────────────────────────────────
        var grn = app.MapGroup("/api/goods-receipts").WithTags("Receiving");

        grn.MapGet("/", async (Guid? siteId, string? status, int? page, int? pageSize,
                ReceivingService service, CancellationToken ct) =>
                Results.Ok(await service.ListAsync(siteId, status, page ?? 1, pageSize ?? 50, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("ListGoodsReceipts");

        grn.MapGet("/{id:guid}", async (Guid id, ReceivingService service, CancellationToken ct) =>
                Results.Ok(await service.GetAsync(id, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("GetGoodsReceipt");

        grn.MapPost("/", async (StartReceiptRequest request, ReceivingService service, CancellationToken ct) =>
            {
                var receipt = await service.StartAsync(request.PurchaseOrderId, ct);
                return Results.Created($"/api/goods-receipts/{receipt.Id}", receipt);
            })
            .RequirePermission(Permissions.GoodsReceive)
            .WithName("StartGoodsReceipt")
            .WithSummary("Opens a receipt pre-filled with what is still outstanding on the order.");

        grn.MapPut("/{id:guid}", async (Guid id, SaveReceiptRequest request,
                ReceivingService service, CancellationToken ct) =>
                Results.Ok(await service.UpdateAsync(id, request, ct)))
            .RequirePermission(Permissions.GoodsReceive)
            .WithName("UpdateGoodsReceipt");

        grn.MapPost("/{id:guid}/accept", async (Guid id, AcceptReceiptRequest request,
                ReceivingService service, CancellationToken ct) =>
                Results.Ok(await service.AcceptAsync(id, request, ct)))
            .RequirePermission(Permissions.GoodsReceive)
            .WithName("AcceptGoodsReceipt")
            .WithSummary("Writes the stock movements. All four checks must be ticked, and a shortfall must be decided.");

        grn.MapPost("/{id:guid}/reject", async (Guid id, RejectReceiptRequest request,
                ReceivingService service, CancellationToken ct) =>
                Results.Ok(await service.RejectAsync(id, request, ct)))
            .RequirePermission(Permissions.GoodsReceive)
            .WithName("RejectGoodsReceipt")
            .WithSummary("Nothing enters stock. Photographs are mandatory — the minimum is a setting.");

        // ── documents ────────────────────────────────────────────────────────
        grn.MapPost("/{id:guid}/documents", async (
                Guid id, IFormFile file, string kind, string? caption,
                double? latitude, double? longitude,
                DocumentService documents, CancellationToken ct) =>
            {
                if (!Enum.TryParse<DocumentKind>(kind, true, out var parsed))
                    parsed = DocumentKind.Other;

                var result = await documents.UploadAsync(
                    nameof(Domain.Receiving.GoodsReceipt), id, parsed, file, caption, latitude, longitude, ct);

                return Results.Ok(result);
            })
            .RequirePermission(Permissions.GoodsReceive)
            .DisableAntiforgery()
            .WithName("UploadReceiptDocument")
            .WithSummary("Photos and certificates. Kind: RejectionPhoto, DeliveryChallan, TestCertificate, MaterialPhoto.");

        app.MapGet("/api/documents/{id:guid}", async (
                Guid id, DocumentService documents, CancellationToken ct) =>
            {
                var (content, contentType, fileName) = await documents.OpenAsync(id, ct);
                return Results.File(content, contentType, fileName);
            })
            .RequirePermission(Permissions.StockRead)
            .WithTags("Receiving")
            .WithName("DownloadDocument")
            .WithSummary("Goes through the API so the site-scoping check happens on every read.");

        app.MapDelete("/api/documents/{id:guid}", async (
                Guid id, DocumentService documents, CancellationToken ct) =>
            {
                await documents.DeleteAsync(id, ct);
                return Results.NoContent();
            })
            .RequirePermission(Permissions.GoodsReceive)
            .WithTags("Receiving")
            .WithName("DeleteDocument");

        // ── stock ────────────────────────────────────────────────────────────
        var stock = app.MapGroup("/api/stock").WithTags("Stock");

        stock.MapGet("/", async (Guid siteId, bool? lowOnly,
                InventoryService service, CancellationToken ct) =>
                Results.Ok(await service.StockAsync(siteId, lowOnly == true, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("ListStock")
            .WithSummary("Derived from the movement ledger every time. There is no quantity-on-hand column.");

        stock.MapGet("/elsewhere", async (Guid siteId,
                InventoryService service, CancellationToken ct) =>
                Results.Ok(await service.ElsewhereAsync(siteId, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("StockElsewhere")
            .WithSummary("Other sites holding stock, so an empty shelf can say whether you are simply at the wrong one.");

        stock.MapGet("/{materialId:guid}/history", async (Guid materialId, Guid siteId,
                InventoryService service, CancellationToken ct) =>
                Results.Ok(await service.HistoryAsync(siteId, materialId, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("StockHistory")
            .WithSummary("Every movement with a running balance — the answer to \"why is this number wrong\".");

        stock.MapPut("/settings", async (SaveStockSettingRequest request,
                InventoryService service, CancellationToken ct) =>
                Results.Ok(await service.SaveStockSettingAsync(request, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("SaveStockSetting")
            .WithSummary("The warn-me level. Fires at the level and clears itself on replenishment.");

        stock.MapPost("/adjust", async (AdjustStockRequest request,
                InventoryService service, CancellationToken ct) =>
                Results.Ok(await service.AdjustAsync(request, ct)))
            .RequirePermission(Permissions.StockAdjust)
            .WithName("AdjustStock")
            .WithSummary("Corrects the books to a physical count by appending a movement, never by editing history.");

        // ── consumption ──────────────────────────────────────────────────────
        var consumption = app.MapGroup("/api/consumption").WithTags("Stock");

        consumption.MapGet("/", async (Guid siteId, int? days,
                InventoryService service, CancellationToken ct) =>
                Results.Ok(await service.ListConsumptionAsync(siteId, days ?? 30, ct)))
            .RequirePermission(Permissions.StockRead)
            .WithName("ListConsumption");

        consumption.MapPost("/", async (RecordConsumptionRequest request,
                InventoryService service, CancellationToken ct) =>
                Results.Ok(await service.RecordConsumptionAsync(request, ct)))
            .RequirePermission(Permissions.ConsumptionRecord)
            .WithName("RecordConsumption")
            .WithSummary("Refuses to record more than is on hand. Negative stock is not a state a site can be in.");

        return app;
    }
}
