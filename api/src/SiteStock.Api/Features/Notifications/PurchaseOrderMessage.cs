using System.Globalization;
using System.Net;
using System.Text;
using SiteStock.Api.Domain.Procurement;

namespace SiteStock.Api.Features.Notifications;

/// <summary>
/// Turns a purchase order into something a supplier can act on.
///
/// Two forms, because they are read in different places: an email a storekeeper will print,
/// and a WhatsApp message read on a phone in a yard. The WhatsApp version is deliberately
/// short — everything past the first screen is not read.
/// </summary>
public static class PurchaseOrderMessage
{
    private static readonly CultureInfo India = new("en-IN");

    public static string Subject(PurchaseOrder order, string companyName) =>
        $"Purchase order {order.Number} — {companyName} — delivery by {order.ExpectedDelivery:d MMM yyyy}";

    public static string Html(PurchaseOrder order, string companyName, string? companyGstin, string senderName)
    {
        var rows = new StringBuilder();

        foreach (var line in order.Lines.OrderBy(l => l.Material.Category).ThenBy(l => l.Material.Name))
        {
            rows.Append($"""
                <tr>
                  <td style="padding:10px 12px;border-bottom:1px solid #d8dedc">
                    <b>{E(line.Material.Name)}</b>
                    {(string.IsNullOrWhiteSpace(line.Material.Specification)
                        ? "" : $"<br><span style=\"color:#5c6a72;font-size:13px\">{E(line.Material.Specification)}</span>")}
                  </td>
                  <td style="padding:10px 12px;border-bottom:1px solid #d8dedc;text-align:right;white-space:nowrap">
                    {Qty(line.Quantity)} {E(line.Material.Unit.Code)}
                  </td>
                  <td style="padding:10px 12px;border-bottom:1px solid #d8dedc;text-align:right;white-space:nowrap">
                    {Money(line.UnitRate)}
                  </td>
                  <td style="padding:10px 12px;border-bottom:1px solid #d8dedc;text-align:right;white-space:nowrap">
                    {Money(line.LineTotal)}
                  </td>
                </tr>
                """);
        }

        // Inline styles and a table layout, because email clients are twenty years behind
        // browsers and half of them will strip a stylesheet.
        return $"""
            <div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#26343c;max-width:640px">
              <p style="font-size:15px">Dear {E(order.Supplier.ContactPerson ?? order.Supplier.Name)},</p>

              <p style="font-size:15px">
                Please supply the following against our purchase order <b>{E(order.Number)}</b>.
              </p>

              <table style="border-collapse:collapse;width:100%;margin:20px 0;font-size:14px">
                <thead>
                  <tr style="background:#ecefee">
                    <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #d8dedc">Material</th>
                    <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #d8dedc">Quantity</th>
                    <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #d8dedc">Rate</th>
                    <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #d8dedc">Amount</th>
                  </tr>
                </thead>
                <tbody>{rows}</tbody>
                <tfoot>
                  <tr>
                    <td colspan="3" style="padding:8px 12px;text-align:right;color:#5c6a72">Sub-total</td>
                    <td style="padding:8px 12px;text-align:right">{Money(order.SubTotal)}</td>
                  </tr>
                  <tr>
                    <td colspan="3" style="padding:8px 12px;text-align:right;color:#5c6a72">GST</td>
                    <td style="padding:8px 12px;text-align:right">{Money(order.TaxTotal)}</td>
                  </tr>
                  <tr>
                    <td colspan="3" style="padding:10px 12px;text-align:right;font-weight:700;border-top:2px solid #26343c">Total</td>
                    <td style="padding:10px 12px;text-align:right;font-weight:700;border-top:2px solid #26343c">{Money(order.GrandTotal)}</td>
                  </tr>
                </tfoot>
              </table>

              <table style="font-size:14px;margin-bottom:20px">
                <tr><td style="padding:3px 16px 3px 0;color:#5c6a72">Deliver to</td><td><b>{E(order.Site.Name)}</b></td></tr>
                <tr><td style="padding:3px 16px 3px 0;color:#5c6a72">Address</td><td>{E(SiteAddress(order))}</td></tr>
                <tr><td style="padding:3px 16px 3px 0;color:#5c6a72">Required by</td><td><b>{order.ExpectedDelivery:dddd d MMMM yyyy}</b></td></tr>
                <tr><td style="padding:3px 16px 3px 0;color:#5c6a72">Payment terms</td><td>{order.PaymentTermsDays} days</td></tr>
              </table>

              <p style="font-size:14px;color:#5c6a72;background:#f4f6f5;padding:12px 14px;border-radius:8px">
                Please quote <b>{E(order.Number)}</b> on the delivery challan and on your invoice.
                Cement, steel and concrete will not be accepted at site without a test or mill
                certificate. Anything delivered short or damaged will be recorded at the gate.
              </p>

              <p style="font-size:15px">
                Regards,<br>
                <b>{E(senderName)}</b><br>
                {E(companyName)}{(string.IsNullOrWhiteSpace(companyGstin) ? "" : $"<br>GSTIN {E(companyGstin)}")}
              </p>
            </div>
            """;
    }

    public static string Plain(PurchaseOrder order, string companyName, string senderName)
    {
        var lines = string.Join("\n", order.Lines.Select(l =>
            $"  - {l.Material.Name}: {Qty(l.Quantity)} {l.Material.Unit.Code} @ {Money(l.UnitRate)} = {Money(l.LineTotal)}"));

        return $"""
            Dear {order.Supplier.ContactPerson ?? order.Supplier.Name},

            Please supply the following against our purchase order {order.Number}.

            {lines}

            Sub-total: {Money(order.SubTotal)}
            GST: {Money(order.TaxTotal)}
            Total: {Money(order.GrandTotal)}

            Deliver to: {order.Site.Name}, {SiteAddress(order)}
            Required by: {order.ExpectedDelivery:dddd d MMMM yyyy}
            Payment terms: {order.PaymentTermsDays} days

            Please quote {order.Number} on the challan and the invoice. Cement, steel and
            concrete will not be accepted without a test or mill certificate.

            Regards,
            {senderName}
            {companyName}
            """;
    }

    /// <summary>
    /// The WhatsApp version. Short, no table, and readable in the notification preview —
    /// a supplier reads the first two lines and decides whether to open it.
    /// </summary>
    public static string WhatsApp(PurchaseOrder order, string companyName, string senderName)
    {
        var lines = string.Join("\n", order.Lines.Select(l =>
            $"• {l.Material.Name} — *{Qty(l.Quantity)} {l.Material.Unit.Code}* @ {Money(l.UnitRate)}"));

        return $"""
            *Purchase order {order.Number}*
            {companyName}

            {lines}

            *Total: {Money(order.GrandTotal)}* (incl. GST)

            📍 Deliver to: {order.Site.Name}, {SiteAddress(order)}
            📅 Required by: {order.ExpectedDelivery:d MMM yyyy}
            💳 Terms: {order.PaymentTermsDays} days

            Please quote {order.Number} on the challan and invoice. Cement and steel need a test certificate.

            — {senderName}
            """;
    }

    private static string SiteAddress(PurchaseOrder order) =>
        string.Join(", ", new[] { order.Site.AddressLine, order.Site.City, order.Site.Pincode }
            .Where(part => !string.IsNullOrWhiteSpace(part)));

    private static string Money(decimal value) => value.ToString("C0", India).Replace("₹", "₹ ");

    private static string Qty(decimal value) => value.ToString("0.###", India);

    private static string E(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);
}
