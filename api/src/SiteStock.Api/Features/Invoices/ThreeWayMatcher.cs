using Microsoft.EntityFrameworkCore;
using SiteStock.Api.Domain.Billing;
using SiteStock.Api.Domain.Procurement;
using SiteStock.Api.Domain.Receiving;
using SiteStock.Api.Infrastructure.Persistence;

namespace SiteStock.Api.Features.Invoices;

/// <summary>
/// Compares the order, the delivery and the bill, line by line, and says where they
/// disagree.
///
/// <para>This is arithmetic, not intelligence. Every judgement it makes is subtraction
/// against a figure a person recorded, which is why it can always explain itself — and why
/// nobody has to trust a confidence score.</para>
///
/// <para>The detail that decides whether the whole feature is useful or noise: quantity is
/// matched against <b>what was accepted at the gate</b>, honouring the partial-delivery
/// decision, not against what was ordered. Match against the order and every short delivery
/// becomes a false alarm until people stop reading them.</para>
/// </summary>
public sealed class ThreeWayMatcher(SiteStockDbContext db, TimeProvider clock)
{
    /// <summary>Rounding on both sides means a paisa either way is not a dispute.</summary>
    private const decimal MoneyTolerance = 1.00m;
    private const decimal QuantityTolerance = 0.001m;

    public async Task<List<InvoiceVariance>> MatchAsync(Invoice invoice, CancellationToken ct)
    {
        var found = new List<InvoiceVariance>();

        // ── 1. has this supplier already billed under this number? ───────────
        var duplicate = await db.Invoices
            .AsNoTracking()
            .Where(i => i.SupplierId == invoice.SupplierId
                        && i.SupplierInvoiceNumber == invoice.SupplierInvoiceNumber
                        && i.Id != invoice.Id)
            .Select(i => new { i.GrandTotal, i.InvoiceDate })
            .FirstOrDefaultAsync(ct);

        if (duplicate is not null)
        {
            found.Add(new InvoiceVariance
            {
                InvoiceId = invoice.Id,
                Type = VarianceType.DuplicateInvoice,
                ExpectedValue = 0,
                BilledValue = invoice.GrandTotal,
                DifferenceAmount = invoice.GrandTotal,
                Description =
                    $"{invoice.Supplier.Name} has already billed under number " +
                    $"{invoice.SupplierInvoiceNumber}, dated {duplicate.InvoiceDate:d MMM yyyy}, " +
                    $"for {Money(duplicate.GrandTotal)}. Paying both would pay twice.",
            });
        }

        // ── 2. what did we actually accept against this order? ───────────────
        var accepted = await db.GoodsReceiptLines
            .AsNoTracking()
            .Where(l => l.GoodsReceipt.PurchaseOrderId == invoice.PurchaseOrderId
                        && l.GoodsReceipt.Status == GoodsReceiptStatus.Accepted)
            .GroupBy(l => l.PurchaseOrderLineId)
            .Select(g => new { LineId = g.Key, Quantity = g.Sum(l => l.AcceptedQuantity) })
            .ToDictionaryAsync(x => x.LineId, x => x.Quantity, ct);

        // Also what earlier invoices against this order already billed, so a second bill
        // for a second delivery is not flagged for the quantity the first one covered.
        var alreadyBilled = await db.InvoiceLines
            .AsNoTracking()
            .Where(l => l.Invoice.PurchaseOrderId == invoice.PurchaseOrderId
                        && l.Invoice.Id != invoice.Id
                        && l.Invoice.Status != InvoiceStatus.Disputed
                        && l.PurchaseOrderLineId != null)
            .GroupBy(l => l.PurchaseOrderLineId!.Value)
            .Select(g => new { LineId = g.Key, Quantity = g.Sum(l => l.BilledQuantity) })
            .ToDictionaryAsync(x => x.LineId, x => x.Quantity, ct);

        var orderLines = invoice.PurchaseOrder.Lines.ToDictionary(l => l.Id);

        foreach (var line in invoice.Lines)
        {
            // ── 3. billed for something that was never ordered ───────────────
            if (line.PurchaseOrderLineId is null || !orderLines.TryGetValue(line.PurchaseOrderLineId.Value, out var ordered))
            {
                found.Add(new InvoiceVariance
                {
                    InvoiceId = invoice.Id,
                    InvoiceLineId = line.Id,
                    Type = VarianceType.MissingItems,
                    MaterialName = line.Material.Name,
                    ExpectedValue = 0,
                    BilledValue = line.LineTotal + line.TaxAmount,
                    DifferenceAmount = line.LineTotal + line.TaxAmount,
                    Description =
                        $"{line.Material.Name} is on the bill but not on order " +
                        $"{invoice.PurchaseOrder.Number}. Either it was never ordered, or it " +
                        "belongs on a different order.",
                });
                continue;
            }

            accepted.TryGetValue(ordered.Id, out var acceptedQuantity);
            alreadyBilled.TryGetValue(ordered.Id, out var billedBefore);

            var billable = acceptedQuantity - billedBefore;

            // ── 4. billed for more than was accepted ─────────────────────────
            if (line.BilledQuantity - billable > QuantityTolerance)
            {
                var over = line.BilledQuantity - billable;
                var cost = Math.Round(over * line.BilledRate * (1 + line.TaxPercent / 100m), 2);

                found.Add(new InvoiceVariance
                {
                    InvoiceId = invoice.Id,
                    InvoiceLineId = line.Id,
                    Type = VarianceType.QuantityMismatch,
                    MaterialName = line.Material.Name,
                    ExpectedValue = billable,
                    BilledValue = line.BilledQuantity,
                    DifferenceAmount = cost,
                    Description =
                        $"Billed for {Qty(line.BilledQuantity)} {line.Material.Unit.Code} of " +
                        $"{line.Material.Name}, but only {Qty(acceptedQuantity)} was accepted at " +
                        $"the gate" +
                        (billedBefore > 0 ? $" and {Qty(billedBefore)} was billed earlier" : "") +
                        $". That is {Qty(over)} too many, worth {Money(cost)}.",
                });
            }

            // ── 5. billed at a rate other than the agreed one ────────────────
            if (Math.Abs(line.BilledRate - ordered.UnitRate) > 0.001m)
            {
                var difference = Math.Round((line.BilledRate - ordered.UnitRate) * line.BilledQuantity, 2);

                if (Math.Abs(difference) > MoneyTolerance)
                {
                    var dearer = line.BilledRate > ordered.UnitRate;

                    found.Add(new InvoiceVariance
                    {
                        InvoiceId = invoice.Id,
                        InvoiceLineId = line.Id,
                        Type = VarianceType.PriceMismatch,
                        MaterialName = line.Material.Name,
                        ExpectedValue = ordered.UnitRate,
                        BilledValue = line.BilledRate,
                        DifferenceAmount = difference,
                        Description =
                            $"{line.Material.Name} was ordered at {Money(ordered.UnitRate)} but " +
                            $"billed at {Money(line.BilledRate)} — {(dearer ? "dearer" : "cheaper")} " +
                            $"by {Money(Math.Abs(line.BilledRate - ordered.UnitRate))} a " +
                            $"{line.Material.Unit.Code}, {Money(Math.Abs(difference))} over the line.",
                    });
                }
            }

            // ── 6. GST at a different rate ───────────────────────────────────
            if (Math.Abs(line.TaxPercent - ordered.TaxPercent) > 0.01m)
            {
                var expectedTax = Math.Round(line.LineTotal * ordered.TaxPercent / 100m, 2);
                var difference = Math.Round(line.TaxAmount - expectedTax, 2);

                if (Math.Abs(difference) > MoneyTolerance)
                {
                    found.Add(new InvoiceVariance
                    {
                        InvoiceId = invoice.Id,
                        InvoiceLineId = line.Id,
                        Type = VarianceType.TaxMismatch,
                        MaterialName = line.Material.Name,
                        ExpectedValue = ordered.TaxPercent,
                        BilledValue = line.TaxPercent,
                        DifferenceAmount = difference,
                        Description =
                            $"GST on {line.Material.Name} was agreed at {ordered.TaxPercent:0.##}% " +
                            $"but billed at {line.TaxPercent:0.##}% — {Money(Math.Abs(difference))} " +
                            $"{(difference > 0 ? "more" : "less")} than expected.",
                    });
                }
            }
        }

        return found;
    }

    /// <summary>
    /// What we actually owe: the billed total, less every difference resolved in our favour.
    /// A variance still open counts against the supplier's figure, because nothing is paid
    /// while a disagreement is unexplained.
    /// </summary>
    public static decimal CalculatePayable(Invoice invoice)
    {
        var payable = invoice.GrandTotal;

        foreach (var variance in invoice.Variances)
        {
            // Accepting the supplier's figure means we pay what they billed, so nothing
            // comes off. Everything else deducts the difference.
            if (variance.Resolution == VarianceResolution.AcceptSupplierFigure) continue;

            if (variance.Type == VarianceType.DuplicateInvoice) continue;

            payable -= variance.DifferenceAmount;
        }

        return Math.Round(Math.Max(0m, payable), 2);
    }

    private static string Money(decimal value) => $"₹{value:N2}";

    private static string Qty(decimal value) => value.ToString("0.###");
}
