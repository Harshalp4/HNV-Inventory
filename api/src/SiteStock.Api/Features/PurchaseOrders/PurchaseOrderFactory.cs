using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Common.Http;
using SiteStock.Api.Common.Security;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.PurchaseOrders;

/// <summary>
/// Turns an approved requisition into purchase orders — <b>one per awarded supplier</b>,
/// because a supplier can only be held to their own lines and will only ever be sent their
/// own document.
///
/// Nothing else in the system creates a purchase order. There is no "new order" screen, by
/// design: an order that did not come through the approval gate would defeat the control
/// the whole workflow exists to provide.
/// </summary>
public sealed class PurchaseOrderFactory(
    SiteStockDbContext db,
    DocumentNumberService numbers,
    ICurrentUser me,
    Settings.SettingsService settings,
    TimeProvider clock)
{
    public async Task<List<PurchaseOrder>> CreateFromApprovedRequisitionAsync(
        Requisition requisition, CancellationToken ct)
    {
        var unpriced = requisition.Lines.Where(l => !l.IsPriced).ToList();
        if (unpriced.Count > 0)
        {
            throw AppException.BadRequest("incomplete_pricing",
                "Every line needs a supplier and a rate before this can be approved.");
        }

        var supplierIds = requisition.Lines.Select(l => l.AwardedSupplierId!.Value).Distinct().ToList();

        var suppliers = await db.Suppliers
            .Where(s => supplierIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, ct);

        var now = clock.GetUtcNow();
        var created = new List<PurchaseOrder>();

        // Read once, and frozen onto each order. A gate switched on next month must not
        // silently freeze the orders already sitting unsent on somebody's desk.
        var needsApproval = await settings.GetAsync(
            Domain.Configuration.SettingKeys.RequireSendApproval, false, ct);

        foreach (var supplierId in supplierIds.OrderBy(id => suppliers[id].Name))
        {
            var supplier = suppliers[supplierId];
            var lines = requisition.Lines.Where(l => l.AwardedSupplierId == supplierId).ToList();

            var order = new PurchaseOrder
            {
                // HNP, not PO: this is the number the supplier files the order under, and
                // H. N. Power's paperwork has always carried the company's own prefix.
                Number = await numbers.NextAsync("HNP", requisition.Site.Code, ct),
                RequisitionId = requisition.Id,
                SiteId = requisition.SiteId,
                SupplierId = supplierId,
                // Inherited from the requisition, so the job costing is right without
                // anybody remembering to tag each order afterwards.
                WorkOrderId = requisition.WorkOrderId,
                Status = PurchaseOrderStatus.Issued,
                SendApproval = needsApproval
                    ? Domain.Procurement.SendApproval.Pending
                    : Domain.Procurement.SendApproval.NotRequired,
                IssuedAt = now,
                IssuedById = me.Id,
                ExpectedDelivery = requisition.RequiredBy,
                // What was agreed while pricing, falling back to the supplier's usual terms.
                // Copied, not referenced: changing a supplier's terms next year must not
                // silently rewrite what was agreed on this order.
                PaymentTermsDays = requisition.SupplierTerms
                    .FirstOrDefault(t => t.SupplierId == supplierId)?.PaymentTermsDays
                    ?? supplier.PaymentTermsDays,
                // The buyer's note, written while pricing, printed on the order.
                Notes = requisition.SupplierNote,
            };

            foreach (var line in lines)
            {
                var lineTotal = Math.Round(line.Quantity * line.UnitRate!.Value, 2);
                var tax = Math.Round(lineTotal * (line.TaxPercent ?? 0m) / 100m, 2);

                order.Lines.Add(new PurchaseOrderLine
                {
                    RequisitionLineId = line.Id,
                    MaterialId = line.MaterialId,
                    Quantity = line.Quantity,
                    ProductCode = line.ProductCode,
                    Make = line.Make,
                    ListRate = line.ListRate,
                    DiscountPercent = line.DiscountPercent,
                    UnitRate = line.UnitRate!.Value,
                    TaxPercent = line.TaxPercent ?? 0m,
                    LineTotal = lineTotal,
                    TaxAmount = tax,
                    Notes = line.Notes,
                });
            }

            order.SubTotal = order.Lines.Sum(l => l.LineTotal);
            order.TaxTotal = order.Lines.Sum(l => l.TaxAmount);
            order.GrandTotal = order.SubTotal + order.TaxTotal;

            db.PurchaseOrders.Add(order);
            created.Add(order);
        }

        return created;
    }
}
